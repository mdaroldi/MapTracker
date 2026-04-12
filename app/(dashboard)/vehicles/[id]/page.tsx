interface Props {
  params: Promise<{ id: string }>;
}

export default async function VehicleDetailPage({ params }: Props) {
  const { id } = await params;
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Vehicle Detail</h1>
      <p className="mt-2 text-slate-500">Vehicle ID: {id}</p>
    </div>
  );
}
