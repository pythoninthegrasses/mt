# Genius Playlist Creator — Research Summary

Research compiled from [Apple Music Genius documentation](https://support.apple.com/guide/music/use-genius-musbe3694c1b/mac) and [MIT Technology Review: How iTunes Genius Really Works](https://www.technologyreview.com/2010/06/02/91325/how-itunes-genius-really-works/).

## What Genius Does (Apple Music)

Genius is an Apple Music feature that uses anonymous information about users' libraries and listening patterns to identify songs that work well together. It offers two main features:

### Genius Playlists

- User selects a **seed song** and Genius generates a playlist of complementary tracks from the library
- Users can adjust the **maximum number of songs** in the playlist
- A **refresh** option generates different suggestions based on the same seed track
- Requires an Apple Account, internet connection, and a sufficiently large library

### Genius Shuffle

- Instead of a user-selected seed, **Music chooses a song** from the library and plays songs that go well with it
- Users can trigger it repeatedly for new combinations
- Activated via the Controls menu or keyboard shortcut

## How It Works (Technical Details)

Based on disclosures by Apple engineer Erik Goldman (via Quora, reported by MIT Technology Review in 2010):

### Data Collection

- iTunes sends a packet of usage data to Apple: what songs a user has in their library and how often they play them
- This data is "folded into a larger database of users and songs"
- A user's library is compared against all other Genius users' libraries

### Core Algorithms

**Collaborative Filtering**
Genius uses collaborative filtering on purchase/library statistics — finding patterns across millions of users to determine which songs tend to appear together. If many users who have Song A also have Song B, those songs are likely complementary.

**Vector-Space Model & TF-IDF**
Songs are represented in a vector space. Term Frequency–Inverse Document Frequency (tf-idf) is used to weight factors: comparing how often a particular factor (e.g., co-occurrence with another song) appears in a single user's library versus across all iTunes libraries. This prevents universally popular songs from dominating recommendations.

**Latent-Factor Algorithms**
Genius uses latent-factor algorithms that "tend to work very well on huge data sets with an enormous number of dimensions and a lot of noise." These algorithms perform factor analysis to discover hidden variables that explain the variation in observed data. For example, the variability across many songs might be explained by a smaller number of latent factors (mood, energy, genre affinity, etc.).

**Scalability**
Pairwise comparison algorithms were rewritten (building on work from the Netflix Prize competition by AT&T researchers) to scale linearly rather than quadratically, making the system efficient even with millions of users and songs.

### Known Limitations

- Genius ignores relatively unknown songs because it lacks adequate data from users about how those songs connect to others
- Requires a critical mass of user data to work effectively

## Implications for MT

Since MT is a local desktop player without access to crowd-sourced collaborative filtering data, a Genius-like feature would need to rely on alternative signals:

### Available Local Signals

- **Metadata similarity**: genre, artist, album, year, BPM, key
- **Audio feature analysis**: tempo, energy, spectral characteristics (would require audio analysis libraries)
- **Listening history**: tracks frequently played in the same session or close together
- **User curation**: tracks in the same playlists, liked tracks
- **Tag/label similarity**: any user-applied tags or categories

### Possible Approaches

1. **Metadata-based similarity** (simplest): Score tracks by shared genre, similar year, same/related artist, compatible BPM ranges
2. **Audio fingerprint analysis** (moderate complexity): Use audio analysis to extract features like tempo, energy, spectral centroid, and build a similarity matrix
3. **Hybrid approach**: Combine metadata + audio features + listening history for more nuanced results
4. **External data enrichment**: Optionally query Last.fm or MusicBrainz APIs for additional similarity data (tags, similar artists)

### Recommended Starting Point

Start with **metadata-based similarity** as the MVP — it requires no additional dependencies, works offline, and can be enhanced incrementally. The algorithm would:

1. Take a seed track
2. Score all other library tracks on weighted criteria (genre match, artist similarity, year proximity, BPM compatibility)
3. Return the top N tracks as the generated playlist
4. Allow the user to refresh for different results (randomize within similarly-scored tracks)

## UI Layout

The Genius view uses a chat-first layout:

- **Background**: Large transparent glasses graphic centered and rotated ~35 degrees, low opacity so it doesn't obscure controls
- **Empty state**: Animated prompt examples cycle with slow fade transitions ("make me a chill playlist from my library", etc.)
- **Composer**: Positioned at the bottom of the view with a text area and generate button
- **Keyboard shortcut**: Enter triggers generation, Shift+Enter inserts a new line
- **History**: Recent generations listed above the composer when present
- **Onboarding**: Three-step wizard (check Ollama -> download model -> ready) shown before the main interface
