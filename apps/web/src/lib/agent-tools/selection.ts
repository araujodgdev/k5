import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { capabilities, capabilityNames, type CapabilityName } from '@/lib/capabilities/contracts';

const modules = z.enum(['case_tasks', 'case_pages', 'vault', 'knowledge', 'runs', 'artifacts', 'conversations', 'memory', 'citations', 'ui', 'judicial', 'agenda', 'research', 'google', 'whatsapp', 'honorarios', 'calc', 'collaboration', 'messages', 'notifications', 'agent_settings', 'help']);
const entrypoints = [
  'k5_case_tasks_list', 'k5_case_pages_list', 'k5_help_search', 'k5_honorarios_list', 'k5_crm_list_clients', 'k5_agenda_list_activities', 'k5_vault_list_cases',
  'k5_vault_list_documents', 'k5_artifacts_list', 'k5_runs_list', 'k5_knowledge_search', 'k5_conversations_list',
  'k5_collaboration_get', 'k5_messages_list', 'k5_gmail_list_threads', 'k5_whatsapp_list_threads',
  'k5_notifications_list', 'k5_agent_settings_get', 'k5_research_list_web_searches', 'k5_research_start_trademark_search', 'k5_research_analyze_trademark_logo', 'k5_calendar_list_events',
] satisfies CapabilityName[];

/** Keep every authorized module reachable without sending 150 schemas to each model step. */
export function moduleToolSelection(available: ReadonlySet<string>) {
  let selected: z.infer<typeof modules>[] = [];
  const published = capabilityNames.filter(name => available.has(name));
  const availableModules = [...new Set(published.map(name => capabilities[name].module))];
  const active = () => [...new Set([
    ...entrypoints.filter(name => available.has(name)),
    ...published.filter(name => selected.some(module => module === capabilities[name].module)),
    'k5_tools_select_modules', 'updateWorkingMemory', ...(available.has('web_search') ? ['web_search'] : []),
  ])];
  return {
    activeTools: active,
    tool: createTool({
      id: 'k5_tools_select_modules',
      description: `Disponibiliza ferramentas completas de até três módulos para os próximos passos. Módulos autorizados neste turno: ${availableModules.join(', ')}. case_tasks = tarefas compartilhadas do caso e responsáveis; case_pages = páginas compartilhadas, publicação revisada, versões e exportação; honorarios = propostas, precificação, parcelas e recebimentos; calc = cálculos jurídicos, consumidor e tributário federal, com memória e versões; agenda = clientes, tarefas e reuniões; collaboration = associados, participantes e convites; messages = mensagens pessoais; agent_settings = regras e conhecimento do Lume; google = e-mail, calendário, Drive e Docs já conectados. Pode trocar os módulos depois. Não executa ações nem concede permissões.`,
      inputSchema: z.object({ modules: z.array(modules).min(1).max(3) }),
      outputSchema: z.object({ tools: z.array(z.object({ name: z.string(), description: z.string() })) }),
      execute: async ({ modules: requested }) => {
        selected = [...new Set(requested)];
        return { tools: published.filter(name => selected.some(module => module === capabilities[name].module)).map(name => ({ name, description: capabilities[name].description })) };
      },
    }),
  };
}
