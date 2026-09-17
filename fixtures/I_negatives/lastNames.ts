export const lastNames = ["Haas", "Hack", "Hackett", "Hadley"];
export const copy = "hack your business growth";
export const title = "Hack the bot game";
export const todos: string[] = [];
export function removeTodo(t: string) { return todos.filter((x) => x !== t); }
export const store = { remove: (t: string) => removeTodo(t) };
