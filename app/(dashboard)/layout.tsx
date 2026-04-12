export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-64 border-r bg-slate-900 p-4">
        <p className="text-sm text-slate-400">Sidebar — coming soon</p>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
