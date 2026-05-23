export function NoticeBanner({ notice }: { notice: string }) {
  if (!notice) {
    return null;
  }

  return (
    <div className="mb-5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
      {notice}
    </div>
  );
}
