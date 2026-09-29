import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtCurrency, fmtNumber } from "@/lib/format";

type ExampleTransaction = {
  potentialId: string;
  period: string;
  customer: string;
  lab: string;
  repository: "public_cloud" | "private_cloud";
  provider: string;
  lob: string;
  users: number;
  inputCost: number;
  sellingCost: number;
  costSource: "actual" | "entered" | "auto_avg";
};

const EXAMPLE_TRANSACTIONS: ExampleTransaction[] = [
  { potentialId: "DEMO-TX-001", period: "Sep 2026", customer: "Cognizant", lab: "DevOps Pro", repository: "public_cloud", provider: "Azure", lob: "Training", users: 42, inputCost: 48200, sellingCost: 67600, costSource: "actual" },
  { potentialId: "DEMO-TX-002", period: "Sep 2026", customer: "Infosys", lab: "Data Engineering", repository: "public_cloud", provider: "AWS", lob: "Delivery", users: 30, inputCost: 39100, sellingCost: 57500, costSource: "actual" },
  { potentialId: "DEMO-TX-003", period: "Sep 2026", customer: "TCS", lab: "AI Foundations", repository: "public_cloud", provider: "Azure", lob: "Training", users: 55, inputCost: 73400, sellingCost: 96500, costSource: "actual" },
  { potentialId: "DEMO-TX-004", period: "Sep 2026", customer: "HCL", lab: "Cloud Security", repository: "private_cloud", provider: "MakeMyLabs Private Cloud", lob: "Delivery", users: 33, inputCost: 41900, sellingCost: 63100, costSource: "entered" },
  { potentialId: "DEMO-TX-005", period: "Sep 2026", customer: "Accenture", lab: "Platform SRE", repository: "private_cloud", provider: "MakeMyLabs Private Cloud", lob: "Training", users: 37, inputCost: 44600, sellingCost: 68600, costSource: "entered" },
  { potentialId: "DEMO-TX-006", period: "Sep 2026", customer: "Wipro", lab: "Kubernetes Ops", repository: "public_cloud", provider: "GCP", lob: "Support", users: 24, inputCost: 28800, sellingCost: 44600, costSource: "actual" },
  { potentialId: "DEMO-TX-007", period: "Sep 2026", customer: "Capgemini", lab: "API Engineering", repository: "public_cloud", provider: "Azure", lob: "Delivery", users: 20, inputCost: 22900, sellingCost: 35200, costSource: "actual" },
  { potentialId: "DEMO-TX-008", period: "Sep 2026", customer: "TechM", lab: "Observability", repository: "private_cloud", provider: "MakeMyLabs Private Cloud", lob: "Training", users: 26, inputCost: 31200, sellingCost: 47800, costSource: "auto_avg" },
  { potentialId: "DEMO-TX-009", period: "Sep 2026", customer: "LTIMindtree", lab: "Prompt Engineering", repository: "public_cloud", provider: "AWS", lob: "Delivery", users: 46, inputCost: 59200, sellingCost: 87400, costSource: "actual" },
  { potentialId: "DEMO-TX-010", period: "Sep 2026", customer: "Persistent", lab: "FinOps", repository: "private_cloud", provider: "MakeMyLabs Private Cloud", lob: "Support", users: 29, inputCost: 36100, sellingCost: 54800, costSource: "entered" },
];

export function AllTransactionsExampleView() {
  const users = EXAMPLE_TRANSACTIONS.reduce((sum, row) => sum + row.users, 0);
  const revenue = EXAMPLE_TRANSACTIONS.reduce((sum, row) => sum + row.sellingCost, 0);
  const cost = EXAMPLE_TRANSACTIONS.reduce((sum, row) => sum + row.inputCost, 0);
  const profit = revenue - cost;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>{fmtNumber(EXAMPLE_TRANSACTIONS.length)} records</span>
            <span>Users: {fmtNumber(users)}</span>
            <span>Revenue: {fmtCurrency(revenue)}</span>
            <span>Cost: {fmtCurrency(cost)}</span>
            <span>Profit: {fmtCurrency(profit)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">All transactions (example)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Potential ID</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Lab</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>LOB</TableHead>
                <TableHead className="text-right">Users</TableHead>
                <TableHead>Cost source</TableHead>
                <TableHead className="text-right">Input Cost</TableHead>
                <TableHead className="text-right">Selling Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {EXAMPLE_TRANSACTIONS.map((row) => (
                <TableRow key={row.potentialId}>
                  <TableCell className="font-medium">{row.potentialId}</TableCell>
                  <TableCell>{row.period}</TableCell>
                  <TableCell>{row.customer}</TableCell>
                  <TableCell>{row.lab}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {row.repository === "public_cloud" ? "Public Cloud" : "Private Cloud"}
                    </Badge>
                  </TableCell>
                  <TableCell>{row.provider}</TableCell>
                  <TableCell>{row.lob}</TableCell>
                  <TableCell className="text-right">{fmtNumber(row.users)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {row.costSource === "auto_avg" ? "Auto (avg)" : row.costSource}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{fmtCurrency(row.inputCost)}</TableCell>
                  <TableCell className="text-right">{fmtCurrency(row.sellingCost)}</TableCell>
                  <TableCell className="text-right">{fmtCurrency(row.sellingCost - row.inputCost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
