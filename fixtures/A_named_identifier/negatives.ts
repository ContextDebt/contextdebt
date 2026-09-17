export const todos: string[] = [];
export function removeTodo(t: string) { return todos.filter((x) => x !== t); }
const hackyFix = { retries: 3 };
export const config = { hack: true, timeout: 50 };
export default { removeTodo, hackyFix, config };
