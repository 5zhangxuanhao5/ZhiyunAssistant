// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
export function facetValues(row, field, teacherSearch) { const value = field === 'counterpart' ? teacherSearch ? row.title : row.teacher : field === 'room' ? row.room : row.term || ''; return field === 'counterpart' && teacherSearch ? [value] : value.split(/[,，、;；]/).map((part) => part.trim()).filter((part) => !!part); }
export function matchingSearchRows(rows, filters, teacherSearch, omit = '') {
    return rows.filter((row) => (omit === 'counterpart' || !filters.counterpart || facetValues(row, 'counterpart', teacherSearch).includes(filters.counterpart)) && (omit === 'room' || !filters.room || facetValues(row, 'room', teacherSearch).includes(filters.room)) && (omit === 'term' || !filters.term || facetValues(row, 'term', teacherSearch).includes(filters.term)));
}
export function searchFacetOptions(rows, filters, teacherSearch, field) { return Array.from(new Set(matchingSearchRows(rows, filters, teacherSearch, field).reduce((values, row) => values.concat(facetValues(row, field, teacherSearch)), []))).sort((a, b) => b.localeCompare(a)); }
