'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/shared/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CompanyTab } from '@/components/org/CompanyTab';
import { DepartmentTab } from '@/components/org/DepartmentTab';
import { DesignationTab } from '@/components/org/DesignationTab';
import { MappingEditor } from '@/components/org/MappingEditor';
import toast from 'react-hot-toast';
import type { Company, Department, Designation } from '@/types';

type EntityType = 'companies' | 'departments' | 'designations';
type MapType = 'dept-company' | 'desig-dept' | 'desig-company-head';
type OrgTab = 'companies' | 'departments' | 'designations';

const isValidOrgTab = (value: string | null): value is OrgTab => {
  return value === 'companies' || value === 'departments' || value === 'designations';
};

export default function OrgPage() {
  const [activeTab, setActiveTab] = useState<OrgTab>('companies');

  const [companies, setCompanies] = useState<Company[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);

  const [addCompanyName, setAddCompanyName] = useState('');
  const [addCompanyCode, setAddCompanyCode] = useState('');
  const [addDepartmentName, setAddDepartmentName] = useState('');
  const [addDesignationName, setAddDesignationName] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [editEntity, setEditEntity] = useState<EntityType>('companies');
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  const [mapOpen, setMapOpen] = useState(false);
  const [mapType, setMapType] = useState<MapType>('dept-company');
  const [mapSourceId, setMapSourceId] = useState<number | null>(null);
  const [mapSourceName, setMapSourceName] = useState('');
  const [mapOptions, setMapOptions] = useState<{ id: number; name: string }[]>([]);
  const [mapSelected, setMapSelected] = useState<number[]>([]);

  const fetchAll = async () => {
    const [c, d, dg] = await Promise.all([
      fetch('/api/org/companies').then((r) => r.json()),
      fetch('/api/org/departments').then((r) => r.json()),
      fetch('/api/org/designations').then((r) => r.json()),
    ]);
    setCompanies(c.data || []);
    setDepartments(d.data || []);
    setDesignations(dg.data || []);
  };

  useEffect(() => {
    fetchAll().catch(() => toast.error('Failed to load organization data'));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const currentTab = params.get('tab');
    if (isValidOrgTab(currentTab)) {
      setActiveTab(currentTab);
    }
  }, []);

  const handleAdd = async (entity: EntityType, body: Record<string, string>) => {
    try {
      const res = await fetch(`/api/org/${entity}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || 'Failed');
        return;
      }
      toast.success('Added');
      await fetchAll();
    } catch {
      toast.error('Failed');
    }
  };

  const handleDelete = async (entity: EntityType, id: number) => {
    try {
      const res = await fetch(`/api/org/${entity}?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || 'Failed');
        return;
      }
      toast.success('Deleted');
      await fetchAll();
    } catch {
      toast.error('Failed');
    }
  };

  const openEdit = (entity: EntityType, item: { id: number; name: string }) => {
    setEditEntity(entity);
    setEditId(item.id);
    setEditName(item.name);
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editId) {
      return;
    }
    try {
      const res = await fetch(`/api/org/${editEntity}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editId, name: editName }),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || 'Failed');
        return;
      }
      toast.success('Updated');
      setEditOpen(false);
      await fetchAll();
    } catch {
      toast.error('Failed');
    }
  };

  const openMapping = async (type: MapType, sourceId: number, sourceName: string) => {
    setMapType(type);
    setMapSourceId(sourceId);
    setMapSourceName(sourceName);

    const targetEndpoint = type === 'dept-company'
      ? '/api/org/companies'
      : (type === 'desig-company-head' ? '/api/org/companies' : '/api/org/departments');
    const sourceType = type === 'dept-company' ? 'dept' : 'designation';
    const [targetsRes, mappingsRes] = await Promise.all([
      fetch(targetEndpoint).then((r) => r.json()),
      fetch(`/api/org/mappings?type=${type}&sourceId=${sourceId}&sourceType=${sourceType}`).then((r) => r.json()),
    ]);

    const targets = targetsRes.data || [];
    const mapped = (mappingsRes.data || []).map((m: Record<string, number>) => {
      if (type === 'dept-company') return m.company_id;
      if (type === 'desig-company-head') return m.company_id;
      return m.dept_id;
    });

    setMapOptions(targets.map((t: { id: number; name: string; code?: string }) => ({ id: t.id, name: t.code ? `${t.name} (${t.code})` : t.name })));
    setMapSelected(mapped);
    setMapOpen(true);
  };

  const saveMapping = async () => {
    if (!mapSourceId) {
      return;
    }
    try {
      const res = await fetch('/api/org/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: mapType, sourceId: mapSourceId, targetIds: mapSelected }),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || 'Failed');
        return;
      }
      toast.success('Mappings saved');
      setMapOpen(false);
    } catch {
      toast.error('Failed');
    }
  };

  const mappingTitle = useMemo(() => {
    const targetLabel = mapType === 'dept-company'
      ? 'Companies'
      : (mapType === 'desig-company-head' ? 'Companies (as Company Head)' : 'Departments');
    return `Map ${mapSourceName} to ${targetLabel}`;
  }, [mapSourceName, mapType]);

  return (
    <div className="space-y-6">
      <PageHeader title="Organization" subtitle="Manage companies, departments, and designations" />

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (!isValidOrgTab(value)) {
            return;
          }
          setActiveTab(value);
          const params = new URLSearchParams(window.location.search);
          params.set('tab', value);
          window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
        }}
      >
        <TabsList>
          <TabsTrigger value="companies">Companies ({companies.length})</TabsTrigger>
          <TabsTrigger value="departments">Departments ({departments.length})</TabsTrigger>
          <TabsTrigger value="designations">Designations ({designations.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="companies">
          <CompanyTab
            companies={companies}
            addName={addCompanyName}
            addCode={addCompanyCode}
            onAddNameChange={setAddCompanyName}
            onAddCodeChange={setAddCompanyCode}
            onAdd={() => {
              if (!addCompanyName.trim() || !addCompanyCode.trim()) {
                toast.error('Company name and code are required');
                return;
              }
              handleAdd('companies', { name: addCompanyName.trim(), code: addCompanyCode.trim() }).then(() => {
                setAddCompanyName('');
                setAddCompanyCode('');
              });
            }}
            onEdit={(item) => openEdit('companies', item)}
            onDelete={(id) => handleDelete('companies', id)}
          />
        </TabsContent>

        <TabsContent value="departments">
          <DepartmentTab
            departments={departments}
            addName={addDepartmentName}
            onAddNameChange={setAddDepartmentName}
            onAdd={() => {
              if (!addDepartmentName.trim()) {
                toast.error('Department name is required');
                return;
              }
              handleAdd('departments', { name: addDepartmentName.trim() }).then(() => setAddDepartmentName(''));
            }}
            onEdit={(item) => openEdit('departments', item)}
            onDelete={(id) => handleDelete('departments', id)}
            onMap={(item) => openMapping('dept-company', item.id, item.name)}
          />
        </TabsContent>

        <TabsContent value="designations">
          <DesignationTab
            designations={designations}
            addName={addDesignationName}
            onAddNameChange={setAddDesignationName}
            onAdd={() => {
              if (!addDesignationName.trim()) {
                toast.error('Designation name is required');
                return;
              }
              handleAdd('designations', { name: addDesignationName.trim() }).then(() => setAddDesignationName(''));
            }}
            onEdit={(item) => openEdit('designations', item)}
            onDelete={(id) => handleDelete('designations', id)}
            onMapDepartments={(item) => openMapping('desig-dept', item.id, item.name)}
            onMapCompanyHead={(item) => openMapping('desig-company-head', item.id, item.name)}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit</DialogTitle></DialogHeader>
          <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
          <Button onClick={saveEdit} className="w-full">Save</Button>
        </DialogContent>
      </Dialog>

      <MappingEditor
        open={mapOpen}
        title={mappingTitle}
        items={mapOptions}
        selectedIds={mapSelected}
        onToggle={(id, selected) => {
          setMapSelected((prev) => {
            if (selected) {
              return prev.includes(id) ? prev : [...prev, id];
            }
            return prev.filter((x) => x !== id);
          });
        }}
        onSave={saveMapping}
        onOpenChange={setMapOpen}
      />
    </div>
  );
}
