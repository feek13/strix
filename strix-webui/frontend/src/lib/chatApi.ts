import { getUserId } from "./userId";
import { API_BASE_URL } from "./config";
import type { ChatSession, ChatMessageRecord } from "@shared/index";

const headers = () => ({
  "Content-Type": "application/json",
  "X-Strix-User-Id": getUserId(),
});

export async function listSessions(): Promise<ChatSession[]> {
  const res = await fetch(`${API_BASE_URL}/api/chat/sessions`, { headers: headers() });
  if (!res.ok) throw new Error("Failed to list sessions");
  return res.json();
}

export async function createSession(scanId?: string, title?: string, cwd?: string): Promise<ChatSession> {
  const res = await fetch(`${API_BASE_URL}/api/chat/sessions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ scanId, title, cwd }),
  });
  if (!res.ok) throw new Error("Failed to create session");
  return res.json();
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/chat/sessions/${id}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) throw new Error("Failed to delete session");
}

export async function updateSessionTitle(id: string, title: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/chat/sessions/${id}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to update session title");
}

export async function getMessages(sessionId: string): Promise<ChatMessageRecord[]> {
  const res = await fetch(`${API_BASE_URL}/api/chat/sessions/${sessionId}/messages`, { headers: headers() });
  if (!res.ok) throw new Error("Failed to get messages");
  return res.json();
}

export async function saveMessage(
  sessionId: string,
  msg: { role: string; content: string; isExecute?: boolean; blocks?: string },
): Promise<ChatMessageRecord> {
  const res = await fetch(`${API_BASE_URL}/api/chat/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(msg),
  });
  if (!res.ok) throw new Error("Failed to save message");
  return res.json();
}

export async function exportSessionPDF(sessionId: string): Promise<Blob> {
  const res = await fetch(`${API_BASE_URL}/api/chat/sessions/${sessionId}/export/pdf`, {
    headers: { "X-Strix-User-Id": getUserId() },
  });
  if (!res.ok) throw new Error("Failed to export PDF");
  return res.blob();
}

export async function exportSessionDOCX(sessionId: string): Promise<Blob> {
  const res = await fetch(`${API_BASE_URL}/api/chat/sessions/${sessionId}/export/docx`, {
    headers: { "X-Strix-User-Id": getUserId() },
  });
  if (!res.ok) throw new Error("Failed to export DOCX");
  return res.blob();
}
