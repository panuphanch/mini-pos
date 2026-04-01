interface NumPadProps {
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
  label: string;
}

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

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'backspace'];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-800 rounded-xl p-4 w-80 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-gray-400 text-sm mb-1">{label}</div>
        <div className="bg-gray-900 rounded-lg px-4 py-3 text-white text-2xl text-right font-mono mb-3 min-h-[48px]">
          {value || '0'}
        </div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {keys.map((key) => (
            <button
              key={key}
              onClick={() => handleKey(key)}
              className="h-14 rounded-lg bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-white text-xl font-medium flex items-center justify-center"
            >
              {key === 'backspace' ? '⌫' : key}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 h-12 rounded-lg bg-gray-600 hover:bg-gray-500 text-white font-medium"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 h-12 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
