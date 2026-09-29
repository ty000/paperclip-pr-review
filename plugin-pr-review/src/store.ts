import type { PluginDatabaseClient } from "@paperclipai/plugin-sdk";
import type { Mission } from "./workflow.js";

type Row = { state: Mission; version: number };
export class MissionStore {
  constructor(private readonly db: PluginDatabaseClient) {}
  private table() { return `${this.db.namespace}.missions`; }
  async create(mission: Mission): Promise<Mission> {
    await this.db.execute(`INSERT INTO ${this.table()} (id, company_id, repository, pr_number, version, state)
      VALUES ($1, $2, $3, $4, 0, $5::jsonb) ON CONFLICT (company_id, repository, pr_number) DO NOTHING`,
      [mission.id, mission.companyId, mission.repository, mission.prNumber, JSON.stringify(mission)]);
    const rows = await this.db.query<Row>(`SELECT state, version FROM ${this.table()} WHERE company_id=$1 AND repository=$2 AND pr_number=$3`, [mission.companyId, mission.repository, mission.prNumber]);
    if (!rows[0]) throw new Error("Mission insert could not be read back");
    return { ...rows[0].state, version: rows[0].version };
  }
  async get(companyId: string, id: string): Promise<Mission | null> {
    const rows = await this.db.query<Row>(`SELECT state, version FROM ${this.table()} WHERE company_id=$1 AND id=$2`, [companyId, id]);
    return rows[0] ? { ...rows[0].state, version: rows[0].version } : null;
  }
  async list(companyId: string): Promise<Mission[]> {
    const rows = await this.db.query<Row>(`SELECT state, version FROM ${this.table()} WHERE company_id=$1 ORDER BY updated_at DESC LIMIT 200`, [companyId]);
    return rows.map(row => ({ ...row.state, version: row.version }));
  }
  async change(companyId: string, id: string, update: (state: Mission) => Mission): Promise<Mission> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.get(companyId, id);
      if (!current) throw new Error("Mission not found");
      const next = update(current);
      if (next === current) return current;
      next.version = current.version + 1;
      const written = await this.db.execute(`UPDATE ${this.table()} SET state=$1::jsonb, version=version+1, updated_at=now()
        WHERE company_id=$2 AND id=$3 AND version=$4`, [JSON.stringify(next), companyId, id, current.version]);
      if (written.rowCount === 1) return next;
    }
    throw new Error("Mission changed concurrently; retry after reading current state");
  }
}
