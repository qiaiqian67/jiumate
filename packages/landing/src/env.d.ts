/**
 * The address the site is served from, injected at build time by the Vite config (see
 * `define` there). It is the one thing in the app that has to be absolute rather than
 * relative: the one-line installer commands, which a user copies into a shell where the
 * site's own relative URLs do not resolve.
 */
declare const __SITE_ORIGIN__: string;
