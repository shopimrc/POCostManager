/**
 * Ephemeral Shopify session storage for a single embedded store.
 *
 * Shopify's embedded token exchange re-creates sessions after a process restart.
 * No credentials are written to Shopify metaobjects or the Render filesystem.
 * Not suitable for background jobs that require a token when no merchant is present.
 */
export class EmbeddedSessionStorage {
  constructor() { this.sessions = new Map(); }
  async storeSession(session) {
    this.sessions.set(session.id, session);
    return true;
  }
  async loadSession(id) {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (session.expires && new Date(session.expires).getTime() <= Date.now()) {
      this.sessions.delete(id);
      return undefined;
    }
    return session;
  }
  async deleteSession(id) { this.sessions.delete(id); return true; }
  async deleteSessions(ids) { ids.forEach((id) => this.sessions.delete(id)); return true; }
  async findSessionsByShop(shop) {
    return [...this.sessions.values()].filter((session) => session.shop === shop);
  }
  async deleteSessionsByShop(shop) {
    for (const session of await this.findSessionsByShop(shop)) this.sessions.delete(session.id);
    return true;
  }
  async updateSessionsScope(shop, scope) {
    for (const session of await this.findSessionsByShop(shop)) session.scope = scope;
    return true;
  }
}
