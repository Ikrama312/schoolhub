'use client';

import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { BarChart } from '@mui/x-charts/BarChart';
import { LineChart } from '@mui/x-charts/LineChart';
import { Gauge } from '@mui/x-charts/Gauge';
import { ChartsReferenceLine } from '@mui/x-charts/ChartsReferenceLine';

/**
 * PRD-16 NFR-2: every chart gets an aria-label summary (built on the server) and a visually
 * hidden table of the same numbers. Props are serialisable, so server widgets can pass them.
 */
export interface ChartSeriesProps {
  summary: string;
  xAxis: (string | number)[];
  series: { id: string; label: string; data: (number | null)[]; stack?: string }[];
  referenceLine?: number;
}

type Props =
  | { kind: 'line' | 'bar'; chart: ChartSeriesProps; xLabel?: string; height?: number }
  | { kind: 'gauge'; summary: string; value: number; valueMax?: number; label: string; height?: number };

// Same rules as MUI's visuallyHidden (@mui/utils), inlined to avoid an undeclared dependency.
const visuallyHidden = {
  border: 0,
  clip: 'rect(0 0 0 0)',
  height: '1px',
  margin: '-1px',
  overflow: 'hidden',
  padding: 0,
  position: 'absolute',
  whiteSpace: 'nowrap',
  width: '1px',
} as const;

export function ChartA11y(props: Props) {
  const height = props.height ?? 260;

  if (props.kind === 'gauge') {
    return (
      <Box role="figure" aria-label={props.summary}>
        <Gauge value={props.value} valueMax={props.valueMax ?? 100} height={height} aria-label={props.summary} text={`${props.value} %`} />
        <Box component="span" sx={visuallyHidden}>
          {props.label}: {props.value} %
        </Box>
      </Box>
    );
  }

  const { chart, kind } = props;
  const xAxis = [{ scaleType: kind === 'line' ? ('point' as const) : ('band' as const), data: chart.xAxis, label: props.xLabel }];
  const series = chart.series.map((s) => ({ id: s.id, label: s.label, data: s.data, stack: s.stack }));

  return (
    <Box role="figure" aria-label={chart.summary} sx={{ position: 'relative' }}>
      <Box aria-hidden>
        {kind === 'line' ? (
          <LineChart xAxis={xAxis} series={series} height={height}>
            {chart.referenceLine !== undefined && (
              <ChartsReferenceLine y={chart.referenceLine} label={`Threshold ${chart.referenceLine} %`} labelAlign="end" lineStyle={{ strokeDasharray: '6 4' }} />
            )}
          </LineChart>
        ) : (
          <BarChart xAxis={xAxis} series={series} height={height} />
        )}
      </Box>
      <Table size="small" sx={visuallyHidden}>
        <caption>{chart.summary}</caption>
        <TableHead>
          <TableRow>
            <TableCell>{props.xLabel ?? 'Category'}</TableCell>
            {chart.series.map((s) => (
              <TableCell key={s.id}>{s.label}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {chart.xAxis.map((x, i) => (
            <TableRow key={`${x}-${i}`}>
              <TableCell>{x}</TableCell>
              {chart.series.map((s) => (
                <TableCell key={s.id}>{s.data[i] ?? '—'}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
