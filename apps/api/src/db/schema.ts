import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  titleSource: text("title_source", { enum: ["auto", "manual"] })
    .notNull()
    .default("auto"),
  titleTurnId: text("title_turn_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("idx_conversations_updated_at").on(table.updatedAt)]);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    turnId: text("turn_id").notNull(),
    position: integer("position").notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull().default(""),
    reasoningContent: text("reasoning_content"),
    reasoningDurationMs: integer("reasoning_duration_ms"),
    status: text("status", {
      enum: ["streaming", "completed", "stopped", "error"],
    }).notNull(),
    model: text("model"),
    reasoningLevel: text("reasoning_level", {
      enum: ["off", "low", "high", "max"],
    }),
    finishReason: text("finish_reason"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    totalTokens: integer("total_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    errorCode: text("error_code"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("idx_messages_conversation_position").on(
      table.conversationId,
      table.position,
    ),
    index("idx_messages_status").on(table.status),
    index("idx_messages_turn_id").on(table.turnId),
  ],
);

export const touchUpdatedAt = sql`(unixepoch('subsec') * 1000)`;
