'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { signIn, getSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Lock, Shield, Loader2,
  CheckCircle2, Bell, Users, BarChart3,
  Building2, Award, Briefcase, ArrowRight, BookOpen,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { SopModal } from './SopModal';
import type { Company, Department, Designation, DeptCompanyMap, DesigDeptMap, DesigCompanyHeadMap } from '@/types';

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().optional(),
  loginType: z.enum(['ldap', 'local', 'demo', 'sso']),
});

type LoginValues = z.infer<typeof loginSchema>;

function mapLoginError(error?: string | null): string {
  const normalized = String(error || '').toLowerCase();
  if (!normalized) return 'Login failed';
  if (
    normalized.includes('credentialssignin') ||
    normalized.includes('configuration') ||
    normalized.includes('invalid credentials') ||
    normalized.includes('invalid password')
  ) {
    return 'Incorrect username or password';
  }
  return String(error);
}

const fieldInputClass =
  'w-full border-0 border-b border-border bg-transparent py-2 px-0.5 pb-3 text-[15.5px] text-foreground outline-none focus:border-primary transition-colors placeholder:text-muted-foreground/60';

const fieldLabelClass = 'block text-[11.5px] uppercase tracking-[1px] text-muted-foreground mb-2';

function LoginTab({
  loginType, loading, onSubmit, usernamePlaceholder, passwordPlaceholder, submitLabel,
}: {
  loginType: LoginValues['loginType'];
  loading: boolean;
  onSubmit: (values: LoginValues) => Promise<void>;
  usernamePlaceholder: string;
  passwordPlaceholder?: string;
  submitLabel: string;
}) {
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '', loginType },
  });

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <div className="mb-[18px]">
        <label className={fieldLabelClass}>Username</label>
        <input type="text" placeholder={usernamePlaceholder} className={fieldInputClass} {...form.register('username')} />
        {form.formState.errors.username && (
          <p className="text-xs text-destructive mt-1.5">{form.formState.errors.username.message}</p>
        )}
      </div>

      {loginType !== 'demo' && (
        <div className="mb-[14px]">
          <label className={fieldLabelClass}>Password</label>
          <input type="password" placeholder={passwordPlaceholder} className={fieldInputClass} {...form.register('password')} />
        </div>
      )}

      <input type="hidden" value={loginType} {...form.register('loginType')} />

      <label className="flex items-center gap-2 text-[13px] text-muted-foreground mt-[14px] mb-5 cursor-pointer select-none">
        <input type="checkbox" className="h-3.5 w-3.5 accent-primary" />
        Remember this device
      </label>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-primary text-primary-foreground py-3.5 text-[14.5px] font-semibold tracking-[0.4px] flex items-center justify-center gap-2.5 disabled:opacity-60 transition-opacity hover:bg-primary-hover"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ArrowRight className="h-4 w-4" />
        )}
        {submitLabel}
      </button>

      <div className="flex items-center justify-center gap-2 mt-4 text-xs text-muted-foreground">
        <Lock className="h-3 w-3" />
        256-bit encrypted connection
      </div>
    </form>
  );
}

const tabTriggerClass =
  'flex-1 bg-transparent rounded-none shadow-none h-auto px-0 pb-3.5 text-[13.5px] font-semibold tracking-[0.3px] text-muted-foreground border-0 border-b-2 border-transparent data-[state=active]:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none transition-colors';

const selectTriggerClass =
  'border-0 border-b border-border rounded-none bg-transparent px-0.5 h-auto py-2 pb-3 text-[15.5px] focus:ring-0 focus:border-primary';

const selectContentClass = 'rounded-lg border-border bg-popover backdrop-blur-0 shadow-lg';
const selectItemClass = 'rounded-md focus:bg-accent';

const trustPoints = [
  { icon: CheckCircle2, label: 'Track tasks across departments', sub: 'Stay aligned and on schedule' },
  { icon: Bell, label: 'Automated reminders & alerts', sub: 'Never miss an important update' },
  { icon: Users, label: 'Role-based team collaboration', sub: 'The right access for the right people' },
  { icon: BarChart3, label: 'Insights & performance analytics', sub: 'Make data-driven decisions' },
];

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackParam = searchParams.get('callbackUrl');
  const callbackUrl = React.useMemo(() => {
    if (!callbackParam) return '/dashboard';
    if (!callbackParam.startsWith('/') || callbackParam.startsWith('//')) return '/dashboard';
    return callbackParam;
  }, [callbackParam]);

  const [loading, setLoading] = useState(false);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [ssoAutoLogin, setSsoAutoLogin] = useState(false);
  const [ssoAttempted, setSsoAttempted] = useState(false);
  const [showSop, setShowSop] = useState(false);

  // Profile setup phase (shown inline after first login)
  const [phase, setPhase] = useState<'credentials' | 'profile'>('credentials');
  const [profileLoading, setProfileLoading] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [deptCompanyMap, setDeptCompanyMap] = useState<DeptCompanyMap[]>([]);
  const [desigDeptMap, setDesigDeptMap] = useState<DesigDeptMap[]>([]);
  const [desigCompanyHeadMap, setDesigCompanyHeadMap] = useState<DesigCompanyHeadMap[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [deptId, setDeptId] = useState('');
  const [desigId, setDesigId] = useState('');

  const isCompanyHead = useMemo(() => {
    if (!companyId || !desigId) return false;
    return desigCompanyHeadMap.some((m) => String(m.company_id) === companyId && String(m.desig_id) === desigId);
  }, [companyId, desigId, desigCompanyHeadMap]);

  const filteredDepts = useMemo(() => {
    if (!companyId) return [];
    if (desigId && !isCompanyHead) {
      const allowedDesigDeptIds = new Set(desigDeptMap.filter((m) => String(m.desig_id) === desigId).map((m) => m.dept_id));
      const companyDeptIds = new Set(deptCompanyMap.filter((m) => String(m.company_id) === companyId).map((m) => m.dept_id));
      return departments.filter((d) => d.active && allowedDesigDeptIds.has(d.id) && companyDeptIds.has(d.id));
    }
    const mappedIds = deptCompanyMap.filter((m) => String(m.company_id) === companyId).map((m) => m.dept_id);
    return departments.filter((d) => mappedIds.includes(d.id) && d.active);
  }, [companyId, desigId, isCompanyHead, departments, deptCompanyMap, desigDeptMap]);

  const filteredDesigs = useMemo(() => {
    if (!companyId) return [];
    const companyDeptIds = new Set(deptCompanyMap.filter((m) => String(m.company_id) === companyId).map((m) => m.dept_id));
    const fromDept = desigDeptMap.filter((m) => companyDeptIds.has(m.dept_id)).map((m) => m.desig_id);
    const asHead = desigCompanyHeadMap.filter((m) => String(m.company_id) === companyId).map((m) => m.desig_id);
    const all = new Set([...fromDept, ...asHead]);
    return designations.filter((d) => all.has(d.id) && d.active);
  }, [companyId, designations, deptCompanyMap, desigDeptMap, desigCompanyHeadMap]);

  useEffect(() => { setDeptId(''); setDesigId(''); }, [companyId]);
  useEffect(() => { setDeptId(''); }, [desigId]);

  useEffect(() => {
    fetch('/api/config/public')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setDemoEnabled(data.data.demoEnabled);
          setSsoEnabled(data.data.ssoEnabled);
          setSsoAutoLogin(data.data.ssoAutoLogin);
        }
      })
      .catch(() => undefined);
  }, []);

  const fetchOrgData = async () => {
    try {
      const [compRes, deptRes, desigRes, mapRes] = await Promise.all([
        fetch('/api/org/companies'),
        fetch('/api/org/departments'),
        fetch('/api/org/designations'),
        fetch('/api/org/mappings'),
      ]);
      const [compData, deptData, desigData, mapData] = await Promise.all([
        compRes.json(), deptRes.json(), desigRes.json(), mapRes.json(),
      ]);
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

  const afterLogin = async () => {
    const session = await getSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (session?.user && !(session.user as any).onboardingComplete) {
      await fetchOrgData();
      setPhase('profile');
    } else {
      router.push(callbackUrl);
      router.refresh();
    }
  };

  const handleSsoLogin = async (silent = false) => {
    setLoading(true);
    try {
      // The IIS auth bridge is the only place the Windows identity is visible
      // (URL Rewrite cannot forward {LOGON_USER} on the proxied request), so we
      // exchange it for a short-lived ticket first, then sign in with that.
      let ticket = '';
      try {
        const bridgeRes = await fetch('/api/sso/negotiate', { credentials: 'include' });
        if (bridgeRes.ok) {
          const bridgeData = await bridgeRes.json();
          ticket = bridgeData?.data?.ticket || '';
        }
      } catch {
        // fall through — reported as a failed SSO attempt below
      }

      if (!ticket) {
        if (!silent) toast.error('No domain credentials detected. Sign in with your username and password.');
        return;
      }

      const result = await signIn('credentials', {
        redirect: false, username: 'sso', password: ticket, loginType: 'sso',
      });
      if (result?.error) {
        if (!silent) toast.error(mapLoginError(result.error));
        return;
      }
      if (!silent) toast.success('Domain SSO login successful');
      await afterLogin();
    } catch {
      if (!silent) toast.error('Domain SSO login failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!ssoEnabled || !ssoAutoLogin || ssoAttempted) return;
    setSsoAttempted(true);
    handleSsoLogin(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ssoEnabled, ssoAutoLogin, ssoAttempted]);

  const handleLogin = async (values: LoginValues) => {
    setLoading(true);
    try {
      const result = await signIn('credentials', {
        redirect: false,
        username: values.username,
        password: values.password || '',
        loginType: values.loginType,
      });
      if (result?.error) {
        toast.error(mapLoginError(result.error));
      } else {
        toast.success('Login successful');
        await afterLogin();
      }
    } catch {
      toast.error('Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleProfileSubmit = async () => {
    if (!companyId || !desigId || (!isCompanyHead && !deptId)) {
      toast.error('Please select all required fields');
      return;
    }
    setProfileLoading(true);
    try {
      const res = await fetch('/api/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: parseInt(companyId, 10),
          deptId: isCompanyHead ? null : parseInt(deptId, 10),
          desigId: parseInt(desigId, 10),
        }),
      });
      const data = await res.json();
      if (data.success) {
        router.push(callbackUrl);
        router.refresh();
      } else {
        toast.error(data.error || 'Profile setup failed');
      }
    } catch {
      toast.error('Something went wrong');
    } finally {
      setProfileLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col bg-background text-foreground">

      {/* ── Top bar ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 sm:px-10 lg:px-14 py-[18px] border-b border-border">
        <div className="flex items-center gap-3">
          <div className="h-[34px] w-[34px] shrink-0 rounded-lg bg-primary text-primary-foreground flex items-center justify-center text-base font-heading font-semibold tracking-[0.5px]">
            TT
          </div>
          <div className="text-[15px] font-semibold tracking-[0.3px]">TaskTracker</div>
          <div className="w-px h-4 bg-border mx-1 hidden sm:block" />
          <div className="hidden sm:block text-xs uppercase tracking-[1.2px] text-muted-foreground">Enterprise Portal</div>
        </div>
        <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-success inline-block shrink-0" />
          <span className="hidden sm:inline">System status: Operational</span>
        </div>
      </div>

      {/* ── Main content ───────────────────────────────────────── */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] items-center max-w-[1280px] mx-auto w-full box-border px-6 sm:px-10 lg:px-14 py-9 gap-10 lg:gap-12">

        {/* Hero column */}
        <div className="min-w-0 order-2 lg:order-1">
          <p className="text-xs uppercase tracking-[2px] font-semibold mb-3.5 text-primary">Secure Access</p>
          <h1 className="font-heading font-semibold text-[32px] sm:text-[38px] lg:text-[42px] leading-[1.08] tracking-[-0.5px] mb-3.5">
            Welcome back<span className="text-primary">.</span>
          </h1>
          <p className="text-base leading-[1.55] text-muted-foreground max-w-[420px] mb-7">
            Sign in with your organization credentials to access the task portal.
          </p>

          <div className="flex flex-col gap-4 border-t border-border pt-[22px] max-w-[420px]">
            {trustPoints.map((pt, i) => (
              <div key={pt.label} className="flex items-baseline gap-3.5">
                <div className="font-heading text-sm w-[22px] shrink-0 text-primary">
                  {String(i + 1).padStart(2, '0')}
                </div>
                <div>
                  <p className="text-sm">{pt.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{pt.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Card column */}
        <div className="min-w-0 order-1 lg:order-2 w-full max-w-[460px] mx-auto lg:mx-0 lg:justify-self-end">
          {phase === 'credentials' ? (
            <div className="rounded-2xl border border-border bg-card px-7 sm:px-9 py-8 shadow-sm">

              {ssoEnabled && (
                <div className="mb-5">
                  <button
                    type="button"
                    onClick={() => handleSsoLogin(false)}
                    disabled={loading}
                    className="w-full rounded-lg border border-foreground/30 py-3 text-[13.5px] font-semibold tracking-[0.3px] flex items-center justify-center gap-2 disabled:opacity-60 transition-opacity hover:bg-muted"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                    Sign in with Domain SSO
                  </button>
                  <div className="flex items-center gap-3 my-5">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-[11px] uppercase tracking-[0.8px] text-muted-foreground">or sign in manually</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                </div>
              )}

              <Tabs defaultValue="ldap">
                <TabsList className="flex w-full border-0 border-b border-border mb-6 bg-transparent p-0 rounded-none h-auto">
                  <TabsTrigger value="ldap" className={tabTriggerClass}>Domain (AD)</TabsTrigger>
                  <TabsTrigger value="local" className={tabTriggerClass}>Local Account</TabsTrigger>
                  {demoEnabled && <TabsTrigger value="demo" className={tabTriggerClass}>Demo</TabsTrigger>}
                </TabsList>

                <TabsContent value="ldap" className="mt-0">
                  <LoginTab
                    loginType="ldap"
                    loading={loading}
                    onSubmit={handleLogin}
                    usernamePlaceholder="Domain username"
                    passwordPlaceholder="Domain password"
                    submitLabel="Sign in"
                  />
                </TabsContent>
                <TabsContent value="local" className="mt-0">
                  <LoginTab
                    loginType="local"
                    loading={loading}
                    onSubmit={handleLogin}
                    usernamePlaceholder="Local username"
                    passwordPlaceholder="Local account password"
                    submitLabel="Sign in"
                  />
                </TabsContent>
                {demoEnabled && (
                  <TabsContent value="demo" className="mt-0">
                    <LoginTab
                      loginType="demo"
                      loading={loading}
                      onSubmit={handleLogin}
                      usernamePlaceholder="Any username"
                      submitLabel="Enter Demo"
                    />
                  </TabsContent>
                )}
              </Tabs>
            </div>
          ) : (
            /* ── Profile setup (inline, shown after first login) ── */
            <div className="rounded-2xl border border-border bg-card px-7 sm:px-9 py-8 shadow-sm">

              <div className="flex items-center gap-3 mb-6">
                <div className="h-11 w-11 rounded-lg flex items-center justify-center border border-primary/30 bg-primary/10 shrink-0">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-heading text-lg font-semibold tracking-tight">Complete Your Profile</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Select your company, designation, and department</p>
                </div>
              </div>

              <div className="space-y-5">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[11.5px] uppercase tracking-[1px] text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5" /> Company
                  </label>
                  <Select value={companyId} onValueChange={setCompanyId}>
                    <SelectTrigger className={selectTriggerClass}>
                      <SelectValue placeholder="Select your company" />
                    </SelectTrigger>
                    <SelectContent className={selectContentClass}>
                      {companies.filter((c) => c.active).map((c) => (
                        <SelectItem key={c.id} value={String(c.id)} className={selectItemClass}>{c.name} ({c.code})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[11.5px] uppercase tracking-[1px] text-muted-foreground">
                    <Award className="h-3.5 w-3.5" /> Designation
                  </label>
                  <Select value={desigId} onValueChange={setDesigId} disabled={!companyId}>
                    <SelectTrigger className={selectTriggerClass}>
                      <SelectValue placeholder={companyId ? 'Select designation' : 'Select a company first'} />
                    </SelectTrigger>
                    <SelectContent className={selectContentClass}>
                      {filteredDesigs.map((d) => (
                        <SelectItem key={d.id} value={String(d.id)} className={selectItemClass}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {!isCompanyHead && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-[11.5px] uppercase tracking-[1px] text-muted-foreground">
                      <Briefcase className="h-3.5 w-3.5" /> Department
                    </label>
                    <Select value={deptId} onValueChange={setDeptId} disabled={!companyId || !desigId}>
                      <SelectTrigger className={selectTriggerClass}>
                        <SelectValue placeholder={desigId ? 'Select department' : 'Select designation first'} />
                      </SelectTrigger>
                      <SelectContent className={selectContentClass}>
                        {filteredDepts.map((d) => (
                          <SelectItem key={d.id} value={String(d.id)} className={selectItemClass}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {isCompanyHead && (
                  <p className="text-xs text-muted-foreground">
                    This designation is a Company Head role — department is not required.
                  </p>
                )}
              </div>

              <button
                onClick={handleProfileSubmit}
                disabled={!companyId || !desigId || (!isCompanyHead && !deptId) || profileLoading}
                className="w-full mt-7 rounded-lg bg-primary text-primary-foreground py-3.5 text-[14.5px] font-semibold tracking-[0.4px] flex items-center justify-center gap-2.5 disabled:opacity-50 transition-opacity hover:bg-primary-hover"
              >
                {profileLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Continue to Dashboard
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 sm:px-10 lg:px-14 py-4 border-t border-border text-xs text-muted-foreground">
        <div>Internal use only &middot; &copy; {new Date().getFullYear()} TaskTracker</div>
        <button
          type="button"
          onClick={() => setShowSop(true)}
          className="flex items-center gap-2 hover:text-foreground transition-colors"
        >
          <BookOpen className="h-3.5 w-3.5" />
          <span>New here? View the user guide &mdash; step-by-step guide to get started</span>
        </button>
      </div>

      <SopModal open={showSop} onClose={() => setShowSop(false)} />
    </div>
  );
}
