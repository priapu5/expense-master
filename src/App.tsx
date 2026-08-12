import { useState } from 'react';
import { useAppData } from './state/AppDataContext';
import { useSettings } from './state/SettingsContext';
import { TabBar, type Tab } from './components/layout';
import { ToastHost, Spinner } from './components/ui';
import { CompaniesScreen } from './components/screens/CompaniesScreen';
import { CompanyDetailScreen } from './components/screens/CompanyDetailScreen';
import { ProjectDetailScreen } from './components/screens/ProjectDetailScreen';
import { QueryScreen } from './components/screens/QueryScreen';
import { SettingsScreen } from './components/screens/SettingsScreen';

export default function App() {
  const { loaded } = useAppData();
  const { loaded: settingsLoaded } = useSettings();
  const [tab, setTab] = useState<Tab>('companies');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  if (!loaded || !settingsLoaded) {
    return (
      <div className="splash">
        <Spinner size={30} />
        <div>Loading…</div>
      </div>
    );
  }

  const openSettings = () => setTab('settings');

  return (
    <div className="app">
      {tab === 'companies' &&
        (companyId ? (
          projectId ? (
            <ProjectDetailScreen projectId={projectId} onBack={() => setProjectId(null)} onOpenSettings={openSettings} />
          ) : (
            <CompanyDetailScreen
              companyId={companyId}
              onBack={() => setCompanyId(null)}
              onOpenProject={(id) => setProjectId(id)}
            />
          )
        ) : (
          <CompaniesScreen onOpenCompany={(id) => setCompanyId(id)} />
        ))}
      {tab === 'query' && <QueryScreen />}
      {tab === 'settings' && <SettingsScreen />}
      <TabBar tab={tab} onChange={setTab} />
      <ToastHost />
    </div>
  );
}
