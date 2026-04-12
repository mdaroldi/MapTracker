interface Props {
  params: Promise<{ id: string }>;
}

export default async function DriverDetailPage({ params }: Props) {
  const { id } = await params;
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Driver Detail</h1>
      <p className="mt-2 text-slate-500">Driver ID: {id}</p>
    </div>
  );
}
