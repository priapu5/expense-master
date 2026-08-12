import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as repos from '../db/repos';
import type { Company, Project, ReceiptInfo, Transaction } from '../types';

interface AppDataCtxValue {
  companies: Company[];
  projects: Project[];
  transactions: Transaction[];
  loaded: boolean;
  reload: () => Promise<void>;
  createCompany: (input: { name: string; icon: Company['icon'] }) => Promise<Company>;
  updateCompany: (c: Company) => Promise<void>;
  deleteCompany: (id: string) => Promise<void>;
  createProject: (input: { companyId: string; name: string; description?: string }) => Promise<Project>;
  updateProject: (p: Project) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  addTransaction: (input: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Transaction>;
  updateTransaction: (t: Transaction) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  setReceipt: (id: string, receipt: ReceiptInfo) => Promise<void>;
  projectById: Map<string, Project>;
  companyById: Map<string, Company>;
}

const AppDataCtx = createContext<AppDataCtxValue | null>(null);

async function loadAll() {
  const db = await import('../db/db').then((m) => m.getDB());
  const [companies, projects, transactions] = await Promise.all([
    db.getAll('companies'),
    db.getAll('projects'),
    db.getAll('transactions'),
  ]);
  companies.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  projects.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt)));
  return { companies, projects, transactions };
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const data = await loadAll();
    setCompanies(data.companies);
    setProjects(data.projects);
    setTransactions(data.transactions);
    setLoaded(true);
  }, []);

  useEffect(() => {
    reload().catch((err) => console.error('Failed to load app data', err));
  }, [reload]);

  const value = useMemo<AppDataCtxValue>(() => {
    const companyById = new Map(companies.map((c) => [c.id, c]));
    const projectById = new Map(projects.map((p) => [p.id, p]));

    return {
      companies,
      projects,
      transactions,
      loaded,
      reload,
      companyById,
      projectById,
      createCompany: async (input) => {
        const c = await repos.createCompany(input);
        setCompanies((prev) => [...prev, c]);
        return c;
      },
      updateCompany: async (c) => {
        await repos.updateCompany(c);
        setCompanies((prev) => prev.map((x) => (x.id === c.id ? c : x)));
      },
      deleteCompany: async (id) => {
        const projectIds = projects.filter((p) => p.companyId === id).map((p) => p.id);
        await repos.deleteCompany(id);
        setCompanies((prev) => prev.filter((c) => c.id !== id));
        setProjects((prev) => prev.filter((p) => p.companyId !== id));
        setTransactions((prev) => prev.filter((t) => !projectIds.includes(t.projectId)));
      },
      createProject: async (input) => {
        const p = await repos.createProject(input);
        setProjects((prev) => [...prev, p]);
        return p;
      },
      updateProject: async (p) => {
        await repos.updateProject(p);
        setProjects((prev) => prev.map((x) => (x.id === p.id ? p : x)));
      },
      deleteProject: async (id) => {
        await repos.deleteProject(id);
        setProjects((prev) => prev.filter((p) => p.id !== id));
        setTransactions((prev) => prev.filter((t) => t.projectId !== id));
      },
      addTransaction: async (input) => {
        const t = await repos.addTransaction(input);
        setTransactions((prev) =>
          [...prev, t].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt))),
        );
        return t;
      },
      updateTransaction: async (t) => {
        await repos.updateTransaction(t);
        setTransactions((prev) => prev.map((x) => (x.id === t.id ? t : x)));
      },
      deleteTransaction: async (id) => {
        await repos.deleteTransaction(id);
        setTransactions((prev) => prev.filter((t) => t.id !== id));
      },
      setReceipt: async (id, receipt) => {
        setTransactions((prev) => {
          const target = prev.find((t) => t.id === id);
          if (!target) return prev;
          const updated: Transaction = { ...target, receipt, updatedAt: new Date().toISOString() };
          repos.updateTransaction(updated).catch(console.error);
          return prev.map((x) => (x.id === id ? updated : x));
        });
      },
    };
  }, [companies, projects, transactions, loaded, reload]);

  return <AppDataCtx.Provider value={value}>{children}</AppDataCtx.Provider>;
}

export function useAppData(): AppDataCtxValue {
  const ctx = useContext(AppDataCtx);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
