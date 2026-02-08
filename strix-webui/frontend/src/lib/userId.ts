export function getUserId(): string {
  let id = localStorage.getItem("strix-user-id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("strix-user-id", id);
  }
  return id;
}
