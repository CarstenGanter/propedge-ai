export const THEME_STORAGE_KEY = "propedge-theme";

/**
 * Runs in <head> before the first paint (see the Next guide "Preventing flash
 * before hydration"): a saved choice wins; otherwise the dark default that
 * the server renders.
 * Kept out of the "use client" toggle so the server layout gets the string.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
