/**
 * Formats a YYYY-MM-DD string (from <input type="date">) to DD/MM/YYYY
 */
export function formatToApiDate(dateStr: string | null | undefined): string | null {
    if (!dateStr) return null;
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
}

/**
 * Formats a DD/MM/YYYY string from API back to YYYY-MM-DD for <input type="date">
 */
export function formatFromApiDate(apiDateStr: string | null | undefined): string {
    if (!apiDateStr) return '';
    const parts = apiDateStr.split('/');
    if (parts.length === 3) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return apiDateStr;
}
