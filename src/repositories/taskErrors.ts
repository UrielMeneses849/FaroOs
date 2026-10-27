export class TaskNotFoundError extends Error {
  constructor() {
    super('La tarea ya no está en el servidor. Puede haber sido retirada por la limpieza de tareas completadas.')
    this.name = 'TaskNotFoundError'
  }
}
