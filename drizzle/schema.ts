import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

const orderStateEnum = ["pending", "preparing", "served"] as const;

export const maids = sqliteTable("maid", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  imageUrl: text("image_url"),
  isActive: integer("is_active", { mode: "boolean" })
    .notNull()
    .default(false),
  isInstaxAvailable: integer("is_instax_available", { mode: "boolean" })
    .notNull()
    .default(false),
});

export const users = sqliteTable(
  "user",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    maidId: integer("maid_id")
      .references(() => maids.id, { onDelete: "set null" }),
    instaxMaidId: integer("instax_maid_id")
      .references(() => maids.id, { onDelete: "set null" }),
    seatId: integer("seat_id"),
    isValid: integer("is_valid", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    maidIdx: index("idx_user_maid_id").on(table.maidId),
    instaxMaidIdx: index("idx_user_instax_maid_id").on(table.instaxMaidId),
    seatIdx: index("idx_user_seat_id").on(table.seatId),
  }),
);

export const menus = sqliteTable(
  "menu",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    imageUrl: text("image_url"),
    stock: integer("stock").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    nameIdx: index("idx_menu_name").on(table.name),
  }),
);

export const orders = sqliteTable(
  "order",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    menuId: integer("menu_id")
      .notNull()
      .references(() => menus.id, { onDelete: "cascade" }),
    state: text("state", { enum: orderStateEnum })
      .notNull()
      .default(orderStateEnum[0]),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdx: index("idx_order_user_id").on(table.userId),
    menuIdx: index("idx_order_menu_id").on(table.menuId),
  }),
);

export const instaxes = sqliteTable(
  "instax",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    maidId: integer("maid_id")
      .notNull()
      .references(() => maids.id, { onDelete: "cascade" }),
    imageUrl: text("image_url"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdx: index("idx_instax_user_id").on(table.userId),
    maidIdx: index("idx_instax_maid_id").on(table.maidId),
  }),
);

export const instaxHistories = sqliteTable(
  "instax_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    instaxId: integer("instax_id")
      .notNull()
      .references(() => instaxes.id, { onDelete: "cascade" }),
    imageUrl: text("image_url").notNull(),
    archivedAt: text("archived_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    instaxIdx: index("idx_instax_history_instax_id").on(table.instaxId),
  }),
);

export const maidsRelations = relations(maids, ({ many }) => ({
  users: many(users, { relationName: "assignedMaid" }),
  instaxUsers: many(users, { relationName: "instaxMaid" }),
  instaxes: many(instaxes),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  maid: one(maids, {
    fields: [users.maidId],
    references: [maids.id],
    relationName: "assignedMaid",
  }),
  instaxMaid: one(maids, {
    fields: [users.instaxMaidId],
    references: [maids.id],
    relationName: "instaxMaid",
  }),
  orders: many(orders),
  instaxes: many(instaxes),
}));

export const menusRelations = relations(menus, ({ many }) => ({
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  user: one(users, {
    fields: [orders.userId],
    references: [users.id],
  }),
  menu: one(menus, {
    fields: [orders.menuId],
    references: [menus.id],
  }),
}));

export const instaxesRelations = relations(instaxes, ({ one }) => ({
  user: one(users, {
    fields: [instaxes.userId],
    references: [users.id],
  }),
  maid: one(maids, {
    fields: [instaxes.maidId],
    references: [maids.id],
  }),
}));

export const instaxHistoriesRelations = relations(instaxHistories, ({ one }) => ({
  instax: one(instaxes, {
    fields: [instaxHistories.instaxId],
    references: [instaxes.id],
  }),
}));

export type OrderState = (typeof orderStateEnum)[number];
