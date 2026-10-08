/** Serialize lifecycle calls; a failed operation must not poison later starts. */
export function createCompanionTaskQueue() {
  let previous: Promise<boolean> = Promise.resolve(false);
  return (task: () => Promise<boolean>): Promise<boolean> => {
    previous = previous.then(task, task).catch(() => false);
    return previous;
  };
}
