import type { Permissions } from "./types.js";

export function getServerUrl(): string {
  return localStorage.getItem("serverUrl") ?? "";
}

export function getSessionToken(): string {
  return localStorage.getItem("sessionToken") ?? "";
}

export function setServerConfig(url: string, token: string) {
  localStorage.setItem("serverUrl", url.replace(/\/+$/, ""));
  localStorage.setItem("sessionToken", token);
}

export function clearServerConfig() {
  localStorage.removeItem("serverUrl");
  localStorage.removeItem("sessionToken");
}

export async function testConnection(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/api/health`, {
      method: "GET",
      signal,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function loginRequest(url: string, password: string): Promise<{ ok: boolean; token?: string; permissions?: Permissions; expiresAt?: string; error?: string }> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error };
    return { ok: true, token: data.token, permissions: data.permissions, expiresAt: data.expiresAt };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Connection failed" };
  }
}

export async function checkSession(url: string, token: string): Promise<{ authenticated: boolean; permissions?: Permissions }> {
  try {
    const res = await fetch(`${url}/api/auth`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    return await res.json();
  } catch {
    return { authenticated: false };
  }
}

export async function logoutRequest(url: string, token: string) {
  try {
    await fetch(`${url}/api/auth`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` },
    });
  } catch { /* ignore */ }
  clearServerConfig();
}

export async function apiGet(path: string) {
  return apiRequest(path, { method: "GET" });
}

export async function apiRequest(path: string, init: RequestInit) {
  const baseUrl = getServerUrl();
  const token = getSessionToken();
  const hasBody = init.body !== undefined && init.body !== null;
  const headers: Record<string, string> = {
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
    ...(token ? { "Authorization": `Bearer ${token}` } : {}),
  };
  const response = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: { ...headers, ...((init.headers as Record<string, string>) ?? {}) },
  });
  const text = await response.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { throw new Error("Invalid response from server"); } })() : null;
  if (!response.ok) throw new Error(data?.message || data?.error || response.statusText);
  return data;
}
