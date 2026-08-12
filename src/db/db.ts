import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Company, Project, Transaction } from '../types';

export interface AppDBSchema extends DBSchema {
  companies: { key: string; value: Company };
  projects: { key: string; value: Project; indexes: { byCompany: string } };
  transactions: {
    key: string;
    value: Transaction;
    indexes: { byProject: string; byDate: string };
  };
  settings: { key: string; value: unknown };
  fxRates: { key: string; value: { from: string; to: string; rates: Record<string, number> } };
}

const DB_NAME = 'expense-tracker';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<AppDBSchema>> | null = null;

export function getDB(): Promise<IDBPDatabase<AppDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<AppDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('companies', { keyPath: 'id' });
        const projects = db.createObjectStore('projects', { keyPath: 'id' });
        projects.createIndex('byCompany', 'companyId');
        const txs = db.createObjectStore('transactions', { keyPath: 'id' });
        txs.createIndex('byProject', 'projectId');
        txs.createIndex('byDate', 'date');
        db.createObjectStore('settings');
        db.createObjectStore('fxRates');
      },
    });
  }
  return dbPromise;
}
