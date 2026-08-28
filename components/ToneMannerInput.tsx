'use client';

type Props = {
  value: string;
  onChange: (value: string) => void;
};

export default function ToneMannerInput({ value, onChange }: Props) {
  return (
    <label style={{ display: 'block', marginBottom: 24 }}>
      <span className="label">톤앤매너 (선택 입력)</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="예: 짧고 발랄한 반말체, 사용자를 '고객님'으로 지칭하지 않음. 비워두면 업로드한 문서 전체를 분석해 자동으로 판단합니다."
        className="input"
        rows={3}
        style={{ resize: 'vertical', fontFamily: 'inherit' }}
      />
    </label>
  );
}
