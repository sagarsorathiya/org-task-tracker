'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Loader2, Building2, Briefcase, Award } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import type { Company, Department, Designation, DeptCompanyMap, DesigDeptMap, DesigCompanyHeadMap } from '@/types';
import { SopModal } from './SopModal';

export function OnboardingModal() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'profile' | 'welcome'>('profile');

  const [companies, setCompanies] = useState<Company[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [filteredDepts, setFilteredDepts] = useState<Department[]>([]);
  const [filteredDesigs, setFilteredDesigs] = useState<Designation[]>([]);
  const [deptCompanyMap, setDeptCompanyMap] = useState<DeptCompanyMap[]>([]);
  const [desigDeptMap, setDesigDeptMap] = useState<DesigDeptMap[]>([]);
  const [desigCompanyHeadMap, setDesigCompanyHeadMap] = useState<DesigCompanyHeadMap[]>([]);

  const [companyId, setCompanyId] = useState('');
  const [deptId, setDeptId] = useState('');
  const [desigId, setDesigId] = useState('');

  const isCompanyHeadDesignation = React.useMemo(() => {
    if (!companyId || !desigId) return false;
    return desigCompanyHeadMap.some((m) => String(m.company_id) === companyId && String(m.desig_id) === desigId);
  }, [companyId, desigId, desigCompanyHeadMap]);

  useEffect(() => {
    if (session?.user && !session.user.onboardingComplete) {
      setOpen(true);
      fetchOrgData();
    }
  }, [session]);

  const fetchOrgData = async () => {
    try {
      const [compRes, deptRes, desigRes, mapRes] = await Promise.all([
        fetch('/api/org/companies'),
        fetch('/api/org/departments'),
        fetch('/api/org/designations'),
        fetch('/api/org/mappings'),
      ]);
      const [compData, deptData, desigData, mapData] = await Promise.all([compRes.json(), deptRes.json(), desigRes.json(), mapRes.json()]);

      setCompanies(compData.data || []);
      setDepartments(deptData.data || []);
      setDesignations(desigData.data || []);
      setDeptCompanyMap(mapData.data?.deptCompany || []);
      setDesigDeptMap(mapData.data?.desigDept || []);
      setDesigCompanyHeadMap(mapData.data?.desigCompanyHead || []);
    } catch {
      toast.error('Failed to load organization data');
    }
  };

  useEffect(() => {
    if (companyId) {
      const mappedDeptIds = deptCompanyMap
        .filter((m) => String(m.company_id) === companyId)
        .map((m) => m.dept_id);

      const companyDepartments = departments.filter((d) => mappedDeptIds.includes(d.id) && d.active);
      setFilteredDepts(companyDepartments);

      const companyDeptIdSet = new Set(mappedDeptIds.map((id) => String(id)));
      const mappedDesigIdsFromDept = desigDeptMap
        .filter((m) => companyDeptIdSet.has(String(m.dept_id)))
        .map((m) => m.desig_id);
      const mappedDesigIdsAsHead = desigCompanyHeadMap
        .filter((m) => String(m.company_id) === companyId)
        .map((m) => m.desig_id);
      const allMappedDesigIds = new Set([...mappedDesigIdsFromDept, ...mappedDesigIdsAsHead]);
      setFilteredDesigs(designations.filter((d) => allMappedDesigIds.has(d.id) && d.active));

      setDeptId('');
      setDesigId('');
    }
  }, [companyId, departments, designations, deptCompanyMap, desigDeptMap, desigCompanyHeadMap]);

  useEffect(() => {
    if (!companyId || !desigId) {
      return;
    }

    if (isCompanyHeadDesignation) {
      if (deptId) {
        setDeptId('');
      }
      return;
    }

    const allowedDeptIdsForDesignation = new Set(
      desigDeptMap
        .filter((m) => String(m.desig_id) === desigId)
        .map((m) => m.dept_id)
    );

    const companyMappedDeptIds = new Set(
      deptCompanyMap
        .filter((m) => String(m.company_id) === companyId)
        .map((m) => m.dept_id)
    );

    const nextFiltered = departments.filter((d) => d.active && allowedDeptIdsForDesignation.has(d.id) && companyMappedDeptIds.has(d.id));
    setFilteredDepts(nextFiltered);

    if (deptId && !nextFiltered.some((d) => String(d.id) === deptId)) {
      setDeptId('');
    }
  }, [companyId, desigId, deptId, isCompanyHeadDesignation, desigDeptMap, deptCompanyMap, departments]);

  const handleSubmit = async () => {
    if (!companyId || !desigId || (!isCompanyHeadDesignation && !deptId)) {
      toast.error('Please select all fields');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: parseInt(companyId, 10),
          deptId: isCompanyHeadDesignation ? null : parseInt(deptId, 10),
          desigId: parseInt(desigId, 10),
        }),
      });

      const data = await res.json();
      if (data.success) {
        await update();
        setStep('welcome');
      } else {
        toast.error(data.error || 'Onboarding failed');
      }
    } catch {
      toast.error('Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  const handleGetStarted = () => {
    setOpen(false);
    router.push('/dashboard');
    router.refresh();
  };

  if (step === 'welcome') {
    return <SopModal open onClose={handleGetStarted} />;
  }

  return (
    <Dialog open={open} onOpenChange={() => {/* Cannot dismiss */}}>
      <DialogContent
        hideClose
        className="max-w-md"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-xl">Welcome! Complete Your Profile</DialogTitle>
          <DialogDescription>
            Select your company, then designation, then department to complete your profile setup.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* Company */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Building2 className="h-4 w-4 text-primary" /> Company
            </label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger id="onboard-company">
                <SelectValue placeholder="Select company" />
              </SelectTrigger>
              <SelectContent>
                {companies.filter((c) => c.active).map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name} ({c.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Designation */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Award className="h-4 w-4 text-primary" /> Designation
            </label>
            <Select value={desigId} onValueChange={setDesigId} disabled={!companyId}>
              <SelectTrigger id="onboard-desig">
                <SelectValue placeholder={companyId ? 'Select designation' : 'Select a company first'} />
              </SelectTrigger>
              <SelectContent>
                {filteredDesigs.map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Department */}
          {!isCompanyHeadDesignation && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Briefcase className="h-4 w-4 text-primary" /> Department
              </label>
              <Select value={deptId} onValueChange={setDeptId} disabled={!companyId || !desigId}>
                <SelectTrigger id="onboard-dept">
                  <SelectValue placeholder={desigId ? 'Select department' : 'Select designation first'} />
                </SelectTrigger>
                <SelectContent>
                  {filteredDepts.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {isCompanyHeadDesignation && (
            <p className="text-xs text-muted-foreground">Selected designation is mapped as Company Head for this company, so Department is not required.</p>
          )}
        </div>

        <Button
          id="onboard-submit"
          className="w-full font-semibold"
          onClick={handleSubmit}
          disabled={!companyId || !desigId || (!isCompanyHeadDesignation && !deptId) || loading}
        >
          {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Complete Setup
        </Button>
      </DialogContent>
    </Dialog>
  );
}
