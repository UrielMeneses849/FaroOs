import type { FaroData, Goal, LifeArea, Project, Task } from '../types'

const now = '2026-07-23T09:00:00.000Z'
const base = { createdAt: now, updatedAt: now }

const goalSeeds: Array<[string, string, LifeArea, string]> = [
  ['goal-faro', 'Lanzar FARO OS', 'personal', '2026-09-30'],
  ['goal-nexvora', 'Renovar Nexvora', 'nexvora', '2026-11-15'],
  ['goal-portfolio', 'Renovar portafolio', 'portfolio', '2026-10-31'],
  ['goal-europe', 'Preparar viaje a Europa', 'travel', '2027-03-01'],
  ['goal-health', 'Mejorar condición física', 'health', '2026-12-31'],
  ['goal-photo', 'Ahorrar para fotografía', 'finance', '2027-01-15'],
]

export const mockGoals: Goal[] = goalSeeds.map(([id, title, area, targetDate]) => ({
  ...base,
  id,
  title,
  area,
  targetDate,
  status: 'active',
  projectIds: [],
}))

const projectSeeds: Array<[string, string, LifeArea, string | undefined, Project['priority']]> = [
  ['project-faro', 'FARO OS v0.1', 'personal', 'goal-faro', 'high'],
  ['project-nexvora', 'Nexvora 2026', 'nexvora', 'goal-nexvora', 'high'],
  ['project-portfolio', 'Portafolio 2026', 'portfolio', 'goal-portfolio', 'medium'],
  ['project-europe', 'Viaje de cumpleaños', 'travel', 'goal-europe', 'medium'],
  ['project-ai', 'Ruta de IA aplicada', 'learning', undefined, 'high'],
  ['project-health', 'Seguimiento de salud', 'health', 'goal-health', 'medium'],
]

export const mockProjects: Project[] = projectSeeds.map(
  ([id, title, area, goalId, priority]) => ({
    ...base,
    id,
    title,
    area,
    goalId,
    priority,
    startDate: '2026-07-01',
    endDate: '2026-12-31',
    status: 'active',
  }),
)

const taskSeeds: Array<
  [string, string, LifeArea, Task['priority'], Task['status'], string | undefined, string]
> = [
  ['task-1', 'Definir arquitectura de FARO OS', 'personal', 'high', 'doing', 'project-faro', '2026-07-23'],
  ['task-2', 'Mapear oportunidades de IA aplicada', 'learning', 'high', 'todo', 'project-ai', '2026-07-24'],
  ['task-3', 'Seleccionar serie fotográfica', 'portfolio', 'medium', 'todo', 'project-portfolio', '2026-07-26'],
  ['task-4', 'Revisar narrativa de Nexvora', 'nexvora', 'high', 'todo', 'project-nexvora', '2026-07-25'],
  ['task-5', 'Comparar rutas para Europa', 'travel', 'medium', 'inbox', 'project-europe', '2026-08-01'],
  ['task-6', 'Registrar entrenamiento semanal', 'health', 'medium', 'todo', 'project-health', '2026-07-23'],
  ['task-7', 'Actualizar meta de ahorro para cámara', 'finance', 'medium', 'inbox', undefined, '2026-07-28'],
]

export const mockTasks: Task[] = taskSeeds.map(
  ([id, title, area, priority, status, projectId, dueDate]) => ({
    ...base,
    id,
    title,
    area,
    priority,
    status,
    projectId,
    dueDate,
    estimatedMinutes: priority === 'high' ? 60 : 30,
  }),
)

mockGoals.forEach((goal) => {
  goal.projectIds = mockProjects.filter((project) => project.goalId === goal.id).map((project) => project.id)
})

export const demoData: FaroData = {
  ideas: [
    { ...base, id: 'idea-1', title: 'Serie fotográfica sobre arquitectura nocturna', description: 'Explorar una narrativa visual durante fines de semana.', area: 'portfolio', status: 'inbox' },
    { ...base, id: 'idea-2', title: 'Automatizar seguimiento semanal con IA', area: 'learning', status: 'inbox', projectId: 'project-ai' },
  ],
  goals: mockGoals,
  projects: mockProjects,
  tasks: mockTasks,
  studySessions: [
    { ...base, id: 'study-1', topic: 'OpenAI API', skill: 'OpenAI API', area: 'learning', durationMinutes: 45, occurredAt: '2026-07-23T18:00:00.000Z', notes: 'Structured outputs' },
    { ...base, id: 'study-2', topic: 'Prompts para agentes', skill: 'Prompt Engineering', area: 'learning', durationMinutes: 60, occurredAt: '2026-07-22T18:00:00.000Z' },
    { ...base, id: 'study-3', topic: 'Retrieval y embeddings', skill: 'RAG', area: 'learning', durationMinutes: 35, occurredAt: '2026-07-21T18:00:00.000Z' },
    { ...base, id: 'study-4', topic: 'React 19', skill: 'React', area: 'learning', durationMinutes: 50, occurredAt: '2026-07-19T18:00:00.000Z' },
    { ...base, id: 'study-5', topic: 'SEO técnico', skill: 'SEO', area: 'learning', durationMinutes: 30, occurredAt: '2026-07-17T18:00:00.000Z' },
    { ...base, id: 'study-6', topic: 'Composición nocturna', skill: 'Fotografía', area: 'learning', durationMinutes: 40, occurredAt: '2026-07-15T18:00:00.000Z' },
  ],
  transactions: [
    { ...base, id: 'tx-1', description: 'Ahorro para cámara', area: 'finance', amount: 2500, kind: 'saving', occurredAt: '2026-07-20', category: 'Fotografía' },
    { ...base, id: 'tx-2', description: 'Ingreso mensual', area: 'finance', amount: 18000, kind: 'income', occurredAt: '2026-07-15', category: 'Ingresos' },
    { ...base, id: 'tx-3', description: 'Suscripciones', area: 'finance', amount: 850, kind: 'expense', occurredAt: '2026-07-10', category: 'Software' },
    { ...base, id: 'tx-4', description: 'Transporte', area: 'finance', amount: 1200, kind: 'expense', occurredAt: '2026-06-18', category: 'Transporte' },
  ],
  healthLogs: [
    { ...base, id: 'health-1', area: 'health', occurredAt: '2026-07-23', energy: 8, mood: 8, anxiety: 3, sleepHours: 7.5, movementMinutes: 35, trainingMinutes: 35, meditationMinutes: 10, waterLiters: 2.1, weightKg: 72.4 },
    { ...base, id: 'health-2', area: 'health', occurredAt: '2026-07-22', energy: 7, mood: 7, anxiety: 4, sleepHours: 7, meditationMinutes: 8, waterLiters: 1.8, weightKg: 72.6 },
    { ...base, id: 'health-3', area: 'health', occurredAt: '2026-07-21', energy: 6, mood: 6, anxiety: 5, sleepHours: 6.5, trainingMinutes: 40, movementMinutes: 40, waterLiters: 2, weightKg: 72.7 },
    { ...base, id: 'health-4', area: 'health', occurredAt: '2026-07-20', energy: 8, mood: 9, anxiety: 2, sleepHours: 8, trainingMinutes: 30, movementMinutes: 30, meditationMinutes: 12, waterLiters: 2.3, weightKg: 72.8 },
  ],
  treatmentLogs: [],
  journalEntries: [
    { ...base, id: 'journal-1', area: 'personal', title: 'El inicio de FARO', content: 'Construir un sistema que reduzca ruido y dé dirección.', occurredAt: now, mood: 9, gratitude: 'Tener claridad para comenzar.', lesson: 'Lo simple sí puede ser profundo.', tags: ['faro', 'inicio'] },
  ],
}
