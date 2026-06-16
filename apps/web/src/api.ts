import type { Permissions } from "./types.js";

export function parseMagicLink(): { serverUrl: string; apiKey: string } | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) return null;
    const json = JSON.parse(atob(token.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof json.s === "string" && typeof json.k === "string" && json.s && json.k) {
      const url = new URL(json.s);
      if (url.protocol === "https:" || url.protocol === "http:") {
        window.history.replaceState({}, "", window.location.pathname);
        return { serverUrl: json.s.replace(/\/+$/, ""), apiKey: json.k };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function getServerUrl(): string {
  return localStorage.getItem("serverUrl") ?? "";
}

export function getApiKey(): string {
  return localStorage.getItem("apiKey") ?? "";
}

export function setServerConfig(url: string, key: string) {
  localStorage.setItem("serverUrl", url.replace(/\/+$/, ""));
  localStorage.setItem("apiKey", key);
}

export function clearServerConfig() {
  localStorage.removeItem("serverUrl");
  localStorage.removeItem("apiKey");
}

export async function testConnection(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/api/health`, {
      method: "GET",
      headers: { "ngrok-skip-browser-warning": "true" },
      signal,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function loginRequest(url: string, key: string): Promise<{ ok: boolean; permissions?: Permissions; error?: string }> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
      body: JSON.stringify({ key }),
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error };
    return { ok: true, permissions: data.permissions };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Connection failed" };
  }
}

export async function checkSession(url: string): Promise<{ authenticated: boolean; permissions?: Permissions }> {
  try {
    const res = await fetch(`${url}/api/auth`, {
      credentials: "include",
      headers: { "ngrok-skip-browser-warning": "true" },
    });
    return await res.json();
  } catch {
    return { authenticated: false };
  }
}

export async function logoutRequest(url: string) {
  try {
    await fetch(`${url}/api/auth`, {
      method: "DELETE",
      credentials: "include",
      headers: { "ngrok-skip-browser-warning": "true" },
    });
  } catch { /* ignore */ }
  clearServerConfig();
}

export async function apiGet(path: string) {
  return apiRequest(path, { method: "GET" });
}

export async function apiRequest(path: string, init: RequestInit) {
  const baseUrl = getServerUrl();
  const apiKey = getApiKey();
  const hasBody = init.body !== undefined && init.body !== null;
  const headers: Record<string, string> = {
    "ngrok-skip-browser-warning": "true",
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
    ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}),
  };
  const response = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: { ...headers, ...((init.headers as Record<string, string>) ?? {}) },
    credentials: "include",
  });
  const text = await response.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { throw new Error("Invalid response from server"); } })() : null;
  if (!response.ok) throw new Error(data?.message || data?.error || response.statusText);
  return data;
}
