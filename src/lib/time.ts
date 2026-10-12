/** Clock reads kept out of component bodies so renders stay pure. */
export const msFromNow = (d: Date | string | number) => new Date(d).getTime() - Date.now();
export const isPast = (d: Date | string | number) => msFromNow(d) < 0;
