// Isolation guard for the XFCE Bot Desktop harness (plan Task 1).
// Every bot must prove it is on the isolated Bot Desktop before any UI action:
// DISPLAY :20, XDG_CONFIG_HOME under ~/.hermes/bot-desktop/xdg.
// Never treat the user's niri session (WAYLAND_DISPLAY wayland-1) as isolated:
// the wayland value is reported back but never whitelisted on its own.
// Run: node --test tests/xfce/isolation_guard.test.mjs
import { homedir } from 'node:os';
import { join } from 'node:path';

export const BOT_DISPLAY = ':20';
export const BOT_XDG_SUFFIX = '/.hermes/bot-desktop/xdg';

export function botXdgHome(env = process.env) {
    return join(env.HOME ?? homedir(), '.hermes/bot-desktop/xdg');
}

/**
 * Assert the env is the isolated Bot Desktop.
 * @param {NodeJS.ProcessEnv} [env] defaults to process.env
 * @returns {{ok:true, DISPLAY:string, xdgConfigHome:string, waylandDisplay:string}}
 * @throws {Error} on DISPLAY / XDG_CONFIG_HOME mismatch (message names the Bot Desktop)
 */
export function assertIsolated(env = process.env) {
    const display = env.DISPLAY ?? '';
    const xdg = env.XDG_CONFIG_HOME ?? '';
    const expectedXdg = botXdgHome(env);
    if (display !== BOT_DISPLAY) {
        throw new Error(`not Bot Desktop (:20): DISPLAY=${JSON.stringify(display)} expected ":20"`);
    }
    if (xdg !== expectedXdg && !xdg.endsWith(BOT_XDG_SUFFIX)) {
        throw new Error(`not Bot Desktop (:20): XDG_CONFIG_HOME=${JSON.stringify(xdg)} expected ${JSON.stringify(expectedXdg)}`);
    }
    return {
        ok: true,
        DISPLAY: display,
        xdgConfigHome: xdg,
        waylandDisplay: env.WAYLAND_DISPLAY ?? '',
    };
}
