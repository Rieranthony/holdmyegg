export function ChickenTauntBubble({
  message,
  testId
}: {
  message: string | null;
  testId?: string;
}) {
  if (!message) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="chicken-taunt"
      data-testid={testId}
    >
      <span className="chicken-taunt__text">{message}</span>
      <span className="chicken-taunt__tail" />
      <span className="chicken-taunt__tail-inner" />
    </div>
  );
}
