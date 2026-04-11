export interface Agent {
  agent_code: string;
  agent_name: string | null;
  description: string;
  model: string | null;
  tool_groups: string[] | null;
  soul?: string | null;
}

export interface CreateAgentRequest {
  agent_code: string;
  agent_name?: string | null;
  description?: string;
  model?: string | null;
  tool_groups?: string[] | null;
  soul?: string;
}

export interface UpdateAgentRequest {
  agent_name?: string | null;
  description?: string | null;
  model?: string | null;
  tool_groups?: string[] | null;
  soul?: string | null;
}
