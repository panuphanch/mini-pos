import { Delete } from 'lucide-react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

interface NumPadProps {
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
  label: string;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'backspace'] as const;

export default function NumPad({ value, onChange, onConfirm, onClose, label }: NumPadProps) {
  const handleKey = (key: string) => {
    if (key === 'backspace') {
      onChange(value.slice(0, -1));
    } else if (key === '.') {
      if (!value.includes('.')) onChange(value + '.');
    } else {
      onChange(value + key);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>
        <div className="rounded-md bg-muted px-4 py-4 text-right text-3xl font-mono tabular-nums min-h-[64px] flex items-center justify-end">
          {value || '0'}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {KEYS.map((key) => (
            <Button
              key={key}
              variant="outline"
              size="lg"
              className="h-14 text-xl"
              onClick={() => handleKey(key)}
            >
              {key === 'backspace' ? <Delete className="h-5 w-5" /> : key}
            </Button>
          ))}
        </div>
        <div className="flex gap-2 pt-2">
          <Button variant="secondary" size="lg" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button size="lg" onClick={onConfirm} className="flex-1">
            Confirm
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
