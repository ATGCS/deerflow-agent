import type { AIMessage } from "@langchain/langgraph-sdk";

export interface Subtask {
  id: string;
  status: "in_progress" | "completed" | "failed"; // in_progress: 进行中，completed: 已完成，failed: 失败
  subagent_type: string;
  description: string;
  latestMessage?: AIMessage;
  prompt: string;
  result?: string;
  error?: string;
}
