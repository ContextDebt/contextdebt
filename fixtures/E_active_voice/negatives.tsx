// None of these may ever be a marker.
export function MemberRow({ name, onRemove }: { name: string; onRemove: () => void }) {
  const confirmText = "Are you sure you want to remove this member?";
  return (
    <div title={confirmText}>
      <span>{name}</span>
      <button onClick={onRemove}>Remove this member</button>
    </div>
  );
}
// Remove this line not to show stack trace
export const quiet = true;
