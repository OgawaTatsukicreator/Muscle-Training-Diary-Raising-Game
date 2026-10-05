import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { EXTRA_FOOD_KINDS, FOOD_ITEMS, FOOD_KINDS } from "@/lib/domain/growth";

const sql = readFileSync(
  new URL("./0007_more_food_items.sql", import.meta.url),
  "utf8",
);

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  const next = sql.indexOf("create or replace function public.", start + 1);

  return sql.slice(start, next === -1 ? sql.length : next);
}

function caseValues(column: "o_cost" | "o_experience"): Record<string, number> {
  const body = functionBody("food_item_stats");
  // The first CASE is the price, the second the experience.
  const blocks = body.split("case p_kind").slice(1);
  const block = blocks[column === "o_cost" ? 0 : 1];

  return Object.fromEntries(
    [...block.matchAll(/when '([a-z]+)' then (\d+)/g)].map(([, kind, value]) => [
      kind,
      Number(value),
    ]),
  );
}

describe("more food items migration contract", () => {
  it("prices every kind exactly like FOOD_ITEMS in lib/domain/growth.ts", () => {
    const prices = caseValues("o_cost");
    const experience = caseValues("o_experience");

    for (const kind of FOOD_KINDS) {
      expect(prices[kind], `${kind} price`).toBe(FOOD_ITEMS[kind].growthPointCost);
      expect(experience[kind], `${kind} experience`).toBe(FOOD_ITEMS[kind].experience);
    }
    expect(Object.keys(prices).sort()).toEqual([...FOOD_KINDS].sort());
    expect(Object.keys(experience).sort()).toEqual([...FOOD_KINDS].sort());
  });

  it("stores only the new kinds in food_inventory and every kind in the logs", () => {
    const extra = EXTRA_FOOD_KINDS.map((kind) => `'${kind}'`).join(", ");
    const all = ["onigiri", "protein", ...EXTRA_FOOD_KINDS].map((kind) => `'${kind}'`).join(", ");

    expect(sql).toContain(`check (kind in (${extra}))`);
    expect(sql.match(new RegExp(`check \\(kind in \\(${all}\\)\\)`, "g"))).toHaveLength(2);
    expect(sql).toContain(`food_kind in (${all})`);
  });

  it("exposes the new kinds' balances to the client as `items`", () => {
    const items = functionBody("food_items_json");

    for (const kind of EXTRA_FOOD_KINDS) {
      expect(items).toContain(`'${kind}'`);
    }
    expect(functionBody("exchange_food")).toContain("'items', public.food_items_json(v_user_id)");
    expect(functionBody("feed_maso_item")).toContain("'items', public.food_items_json(v_user_id)");
  });

  it("keeps the lock order: mascot, food, then inventory rows", () => {
    for (const name of ["exchange_food", "feed_maso_item"]) {
      const body = functionBody(name);
      const maso = body.indexOf("select * into v_maso");
      const food = body.indexOf("select * into v_food\n");
      const inventory = body.indexOf("from public.food_inventory");

      expect(maso, name).toBeGreaterThan(-1);
      expect(maso, name).toBeLessThan(food);
      expect(food, name).toBeLessThan(inventory);
    }
  });

  it("keeps the RPC authentication checks", () => {
    for (const name of ["exchange_food", "feed_maso_item"]) {
      const body = functionBody(name);

      expect(body).toContain("v_user_id uuid := auth.uid()");
      expect(body).toContain("p_expected_user_id <> v_user_id");
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path = ''");
    }
  });

  it("enables RLS on the inventory and exposes only select", () => {
    expect(sql).toContain("alter table public.food_inventory enable row level security;");
    expect(sql).toContain("grant select on public.food_inventory to authenticated;");
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]*food_inventory/);
  });

  it("keeps the helpers internal", () => {
    for (const signature of ["public.food_item_stats(text)", "public.food_items_json(uuid)"]) {
      expect(sql).toContain(`revoke all on function ${signature} from public, anon, authenticated;`);
    }
  });
});
