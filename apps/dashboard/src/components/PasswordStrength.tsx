import { cx } from "./cx";

interface PasswordStrengthProps {
  /** 0 = no input, 1 = weak, 2 = medium, 3 = strong. */
  strength: 0 | 1 | 2 | 3;
  className?: string;
}

const strengthColors: Record<number, string> = {
  0: "bg-elevated",
  1: "bg-danger",
  2: "bg-warning",
  3: "bg-success",
};

const strengthLabels: Record<number, string> = {
  0: "",
  1: "Weak",
  2: "Medium",
  3: "Strong",
};

const strengthLabelColors: Record<number, string> = {
  0: "",
  1: "text-danger",
  2: "text-warning",
  3: "text-success",
};

export function PasswordStrength({ strength, className }: PasswordStrengthProps) {
  return (
    <div className={className}>
      <div className="flex gap-1 mt-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className={cx(
              "h-0.75 flex-1 rounded-full transition-colors duration-slow",
              i <= strength ? strengthColors[strength] : "bg-elevated",
            )}
          />
        ))}
      </div>
      {strength > 0 && (
        <p className={cx("mt-1 text-2xs", strengthLabelColors[strength])}>
          {strengthLabels[strength]}
        </p>
      )}
    </div>
  );
}
