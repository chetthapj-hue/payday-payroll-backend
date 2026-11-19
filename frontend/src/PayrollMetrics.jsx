import LegacyOvertimeNotice from './LegacyOvertimeNotice';
import { payrollMetrics, metricValue } from './api';

export default function PayrollMetrics({ row }) {
    return <><LegacyOvertimeNotice rows={[row]} /><dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {payrollMetrics.map(([key, label, type]) => <div key={key} className="rounded-2xl border border-slate-200 bg-white p-4"><dt>{label}</dt><dd className="font-semibold">{metricValue(row[key], type)}</dd></div>)}
    </dl></>;
}
