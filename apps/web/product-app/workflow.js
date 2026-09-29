const workflowKey = 'procurex-product-app-workflow';

export function loadWorkflowContext() {
  try {
    return JSON.parse(sessionStorage.getItem(workflowKey) || 'null');
  } catch {
    return null;
  }
}

export function saveWorkflowContext(next) {
  const value = { ...(loadWorkflowContext() || {}), ...next, updatedAt: new Date().toISOString() };
  sessionStorage.setItem(workflowKey, JSON.stringify(value));
  return value;
}

export function clearWorkflowContext() {
  sessionStorage.removeItem(workflowKey);
}
