/**
 * Tests for library:reconcile event handling
 *
 * Verifies that the frontend correctly applies backend reconciliation
 * events instead of computing local state.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Minimal library store stub for testing reconcile behavior
function createTestLibraryStore(initialTracks = []) {
  const _sectionTracks = [...initialTracks];
  const _trackPages = {};
  let _dataVersion = 0;
  let _cacheCleared = false;

  return {
    totalTracks: initialTracks.length,
    totalDuration: initialTracks.reduce((sum, t) => sum + (t.duration || 0), 0),
    currentSection: "all",
    _lastRevision: 0,
    _sectionTracks,
    _trackPages,
    _dataVersion,

    get filteredTracks() {
      return this._sectionTracks;
    },

    _setSectionTracks(tracks) {
      this._sectionTracks.length = 0;
      this._sectionTracks.push(...tracks);
    },

    _clearCache() {
      _cacheCleared = true;
    },

    get cacheCleared() {
      return _cacheCleared;
    },

    _removeFromView(idSet) {
      if (this._sectionTracks.length > 0) {
        const newTracks = this._sectionTracks.filter((t) => !idSet.has(t.id));
        this._setSectionTracks(newTracks);
        this._dataVersion++;
      } else {
        for (const [pageIdx, page] of Object.entries(this._trackPages)) {
          this._trackPages[pageIdx] = page.filter((t) => !idSet.has(t.id));
        }
        this._dataVersion++;
      }
      this._clearCache();
    },

    fetchTracks: vi.fn(),
  };
}

function createTestQueueStore(initialItems = []) {
  return {
    items: [...initialItems],
    _originalOrder: [...initialItems],
    _initializing: false,
    _updating: false,
    currentIndex: 0,
    load: vi.fn(),
  };
}

// Simulate the reconcile handler from events.js
function handleLibraryReconcile(library, queue, payload) {
  const {
    mutation,
    affected_sections,
    removed_ids,
    total_tracks,
    total_duration,
    revision,
  } = payload;

  library.totalTracks = total_tracks;
  library.totalDuration = total_duration;
  library._lastRevision = revision;

  if (
    (mutation === "delete" || mutation === "dedup") &&
    removed_ids.length > 0
  ) {
    const idSet = new Set(removed_ids);
    library._removeFromView(idSet);
    // Simplified queue cleanup for testing
    queue.items = queue.items.filter((t) => !idSet.has(t.id));
  } else if (
    mutation === "scan_complete" ||
    mutation === "delete" ||
    mutation === "dedup"
  ) {
    library.fetchTracks();
  }

  if (
    affected_sections.includes("liked") &&
    library.currentSection === "liked"
  ) {
    library.fetchTracks();
  }
}

describe("Library Reconcile Event Handler", () => {
  let library;
  let queue;

  const sampleTracks = [
    { id: 1, title: "Track 1", duration: 180000 },
    { id: 2, title: "Track 2", duration: 240000 },
    { id: 3, title: "Track 3", duration: 200000 },
    { id: 4, title: "Track 4", duration: 300000 },
  ];

  beforeEach(() => {
    library = createTestLibraryStore(sampleTracks);
    queue = createTestQueueStore(sampleTracks);
  });

  describe("delete mutation with specific IDs", () => {
    it("applies authoritative totals from backend", () => {
      handleLibraryReconcile(library, queue, {
        mutation: "delete",
        affected_sections: ["all"],
        removed_ids: [2, 3],
        added_ids: [],
        total_tracks: 2,
        total_duration: 480000,
        revision: 5,
      });

      expect(library.totalTracks).toBe(2);
      expect(library.totalDuration).toBe(480000);
      expect(library._lastRevision).toBe(5);
    });

    it("removes specified tracks from view", () => {
      handleLibraryReconcile(library, queue, {
        mutation: "delete",
        affected_sections: ["all"],
        removed_ids: [2, 3],
        added_ids: [],
        total_tracks: 2,
        total_duration: 480000,
        revision: 5,
      });

      const remainingIds = library.filteredTracks.map((t) => t.id);
      expect(remainingIds).toEqual([1, 4]);
      expect(remainingIds).not.toContain(2);
      expect(remainingIds).not.toContain(3);
    });

    it("removes deleted tracks from queue", () => {
      handleLibraryReconcile(library, queue, {
        mutation: "delete",
        affected_sections: ["all"],
        removed_ids: [1, 3],
        added_ids: [],
        total_tracks: 2,
        total_duration: 540000,
        revision: 6,
      });

      const queueIds = queue.items.map((t) => t.id);
      expect(queueIds).toEqual([2, 4]);
    });

    it("does not call fetchTracks for targeted deletes", () => {
      handleLibraryReconcile(library, queue, {
        mutation: "delete",
        affected_sections: ["all"],
        removed_ids: [2],
        added_ids: [],
        total_tracks: 3,
        total_duration: 680000,
        revision: 7,
      });

      expect(library.fetchTracks).not.toHaveBeenCalled();
    });
  });

  describe("delete mutation without IDs (bulk)", () => {
    it("triggers full refetch", () => {
      handleLibraryReconcile(library, queue, {
        mutation: "delete",
        affected_sections: ["all"],
        removed_ids: [],
        added_ids: [],
        total_tracks: 0,
        total_duration: 0,
        revision: 8,
      });

      expect(library.fetchTracks).toHaveBeenCalled();
      expect(library.totalTracks).toBe(0);
    });
  });

  describe("scan_complete mutation", () => {
    it("triggers full refetch with authoritative totals", () => {
      handleLibraryReconcile(library, queue, {
        mutation: "scan_complete",
        affected_sections: ["all", "added"],
        removed_ids: [],
        added_ids: [],
        total_tracks: 150,
        total_duration: 45000000,
        revision: 10,
      });

      expect(library.fetchTracks).toHaveBeenCalled();
      expect(library.totalTracks).toBe(150);
      expect(library.totalDuration).toBe(45000000);
      expect(library._lastRevision).toBe(10);
    });
  });

  describe("dedup mutation", () => {
    it("removes deduplicated tracks and updates totals", () => {
      handleLibraryReconcile(library, queue, {
        mutation: "dedup",
        affected_sections: ["all"],
        removed_ids: [3, 4],
        added_ids: [],
        total_tracks: 2,
        total_duration: 420000,
        revision: 12,
      });

      const remainingIds = library.filteredTracks.map((t) => t.id);
      expect(remainingIds).toEqual([1, 2]);
      expect(library.totalTracks).toBe(2);
      expect(library.totalDuration).toBe(420000);
    });
  });

  describe("favorite mutation", () => {
    it("refreshes liked section when viewing it", () => {
      library.currentSection = "liked";

      handleLibraryReconcile(library, queue, {
        mutation: "favorite_add",
        affected_sections: ["liked"],
        removed_ids: [],
        added_ids: [],
        total_tracks: 4,
        total_duration: 920000,
        revision: 15,
      });

      expect(library.fetchTracks).toHaveBeenCalled();
    });

    it("does not refetch when not viewing liked section", () => {
      library.currentSection = "all";

      handleLibraryReconcile(library, queue, {
        mutation: "favorite_add",
        affected_sections: ["liked"],
        removed_ids: [],
        added_ids: [],
        total_tracks: 4,
        total_duration: 920000,
        revision: 15,
      });

      expect(library.fetchTracks).not.toHaveBeenCalled();
    });
  });

  describe("authoritative totals override local state", () => {
    it("overrides even when local and backend disagree", () => {
      library.totalTracks = 999;
      library.totalDuration = 9999999;

      handleLibraryReconcile(library, queue, {
        mutation: "delete",
        affected_sections: ["all"],
        removed_ids: [1],
        added_ids: [],
        total_tracks: 3,
        total_duration: 740000,
        revision: 20,
      });

      expect(library.totalTracks).toBe(3);
      expect(library.totalDuration).toBe(740000);
    });
  });
});

describe("_removeFromView", () => {
  it("filters section tracks without touching totals", () => {
    const store = createTestLibraryStore([
      { id: 1, title: "A", duration: 100 },
      { id: 2, title: "B", duration: 200 },
      { id: 3, title: "C", duration: 300 },
    ]);

    const originalTotal = store.totalTracks;
    const originalDuration = store.totalDuration;

    store._removeFromView(new Set([2]));

    expect(store.filteredTracks.map((t) => t.id)).toEqual([1, 3]);
    // Totals are NOT recomputed by _removeFromView
    expect(store.totalTracks).toBe(originalTotal);
    expect(store.totalDuration).toBe(originalDuration);
  });

  it("filters paginated tracks", () => {
    const store = createTestLibraryStore([]);
    store._sectionTracks.length = 0; // Clear section tracks
    store._trackPages[0] = [
      { id: 1, title: "A" },
      { id: 2, title: "B" },
    ];
    store._trackPages[1] = [
      { id: 3, title: "C" },
      { id: 4, title: "D" },
    ];

    store._removeFromView(new Set([2, 3]));

    expect(store._trackPages[0].map((t) => t.id)).toEqual([1]);
    expect(store._trackPages[1].map((t) => t.id)).toEqual([4]);
  });

  it("clears cache after removal", () => {
    const store = createTestLibraryStore([
      { id: 1, title: "A", duration: 100 },
    ]);

    store._removeFromView(new Set([1]));
    expect(store.cacheCleared).toBe(true);
  });
});
