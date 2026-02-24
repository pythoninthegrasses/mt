// The component reads from 'mt:column-settings' during migration (combined object format)
export const setColumnSettings = async (page, { widths, visibility, order }) => {
  await page.evaluate(({ widths, visibility, order }) => {
    const settings = {};
    if (widths) settings.widths = widths;
    if (visibility) settings.visibility = visibility;
    if (order) settings.order = order;
    localStorage.setItem('mt:column-settings', JSON.stringify(settings));
  }, { widths, visibility, order });
};

export const getColumnSettings = async (page) => {
  return await page.evaluate(() => {
    const data = localStorage.getItem('mt:column-settings');
    if (!data) return { widths: null, visibility: null, order: null };
    try {
      const parsed = JSON.parse(data);
      return {
        widths: parsed.widths || null,
        visibility: parsed.visibility || null,
        order: parsed.order || null,
      };
    } catch {
      return { widths: null, visibility: null, order: null };
    }
  });
};

export const clearColumnSettings = async (page) => {
  await page.evaluate(() => {
    localStorage.removeItem('mt:column-settings');
  });
};
