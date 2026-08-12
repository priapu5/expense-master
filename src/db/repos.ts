import { getDB } from './db';
import { newId } from '../lib/id';
import type { BackupJSON, BackupTransaction, Company, Project, Transaction } from '../types';

const nowIso = () => new Date().toISOString();

// ---------- companies ----------

export async function createCompany(input: { name: string; icon: Company['icon'] }): Promise<Company> {
  const company: Company = { id: newId(), name: input.name, icon: input.icon, createdAt: nowIso() };
  const db = await getDB();
  await db.add('companies', company);
  return company;
}

export async function updateCompany(company: Company): Promise<void> {
  const db = await getDB();
  await db.put('companies', company);
}

/** Deletes the company, its projects and all their transactions in one atomic transaction. */
export async function deleteCompany(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['companies', 'projects', 'transactions'], 'readwrite');
  const projects = await tx.objectStore('projects').index('byCompany').getAllKeys(id);
  for (const projectId of projects) {
    const txIds = await tx.objectStore('transactions').index('byProject').getAllKeys(projectId);
    for (const txId of txIds) await tx.objectStore('transactions').delete(txId);
    await tx.objectStore('projects').delete(projectId);
  }
  await tx.objectStore('companies').delete(id);
  await tx.done;
}

// ---------- projects ----------

export async function createProject(input: {
  companyId: string;
  name: string;
  description?: string;
}): Promise<Project> {
  const project: Project = {
    id: newId(),
    companyId: input.companyId,
    name: input.name,
    description: input.description?.trim() || undefined,
    createdAt: nowIso(),
  };
  const db = await getDB();
  await db.add('projects', project);
  return project;
}

export async function updateProject(project: Project): Promise<void> {
  const db = await getDB();
  await db.put('projects', project);
}

/** Deletes the project and all its transactions atomically. */
export async function deleteProject(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['projects', 'transactions'], 'readwrite');
  const txIds = await tx.objectStore('transactions').index('byProject').getAllKeys(id);
  for (const txId of txIds) await tx.objectStore('transactions').delete(txId);
  await tx.objectStore('projects').delete(id);
  await tx.done;
}

// ---------- transactions ----------

export async function addTransaction(input: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>): Promise<Transaction> {
  const t: Transaction = { ...input, id: newId(), createdAt: nowIso(), updatedAt: nowIso() };
  const db = await getDB();
  await db.add('transactions', t);
  return t;
}

export async function updateTransaction(t: Transaction): Promise<void> {
  const db = await getDB();
  await db.put('transactions', { ...t, updatedAt: nowIso() });
}

export async function deleteTransaction(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('transactions', id);
}

export async function getAllTransactions(): Promise<Transaction[]> {
  const db = await getDB();
  return db.getAll('transactions');
}

export async function getTransactionsByProject(projectId: string): Promise<Transaction[]> {
  const db = await getDB();
  return db.getAllFromIndex('transactions', 'byProject', projectId);
}

// ---------- settings ----------

export async function getSettingsAll(): Promise<Record<string, unknown>> {
  const db = await getDB();
  const keys = (await db.getAllKeys('settings')) as string[];
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = await db.get('settings', k);
  return out;
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await getDB();
  return (await db.get('settings', key)) as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put('settings', value, key);
}

// ---------- backup / restore ----------

/** Full data dump. Receipt blobs are stripped — originals live in Drive. */
export async function exportAll(): Promise<BackupJSON> {
  const db = await getDB();
  const [companies, projects, transactions, settings] = await Promise.all([
    db.getAll('companies'),
    db.getAll('projects'),
    db.getAll('transactions'),
    getSettingsAll(),
  ]);
  return {
    version: 1,
    exportedAt: nowIso(),
    companies,
    projects,
    transactions: transactions.map((t) => {
      if (!t.receipt) return t as BackupTransaction;
      const { blobData, ...rest } = t.receipt;
      return { ...t, receipt: { ...rest, hasBlob: blobData != null } };
    }),
    settings,
  };
}

export async function restoreAll(json: BackupJSON): Promise<void> {
  if (!json || json.version !== 1 || !Array.isArray(json.transactions)) {
    throw new Error('Backup file is not a valid Expense Tracker backup');
  }
  const db = await getDB();
  const tx = db.transaction(['companies', 'projects', 'transactions'], 'readwrite');
  await Promise.all([
    tx.objectStore('companies').clear(),
    tx.objectStore('projects').clear(),
    tx.objectStore('transactions').clear(),
  ]);
  for (const c of json.companies) await tx.objectStore('companies').put(c);
  for (const p of json.projects) await tx.objectStore('projects').put(p);
  for (const t of json.transactions) {
    const b = t.receipt;
    const txObj: Transaction = {
      ...t,
      receipt: b
        ? {
            blobType: b.blobType ?? 'image/jpeg',
            thumbDataUrl: b.thumbDataUrl ?? '',
            thumbW: b.thumbW,
            thumbH: b.thumbH,
            driveFileId: b.driveFileId,
            driveUrl: b.driveUrl,
            driveName: b.driveName,
            syncError: undefined,
            blobData: null, // original lives in Drive
            syncState: 'synced',
          }
        : undefined,
    } as Transaction;
    await tx.objectStore('transactions').put(txObj);
  }
  await tx.done;

  const settingsTx = db.transaction('settings', 'readwrite');
  await settingsTx.objectStore('settings').clear();
  for (const [k, v] of Object.entries(json.settings ?? {})) await settingsTx.objectStore('settings').put(v, k);
  await settingsTx.done;
}
