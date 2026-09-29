import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtCurrency, fmtNumber } from "@/lib/format";

type ExampleCustomer = {
  name: string;
  accountManager: string;
  status: "Active" | "Inactive";
  transactions: number;
  users: number;
  revenue: number;
  cost: number;
};

const EXAMPLE_CUSTOMERS: ExampleCustomer[] = [
  { name: "Cognizant", accountManager: "Ritu Sharma", status: "Active", transactions: 7, users: 138, revenue: 432000, cost: 311500 },
  { name: "Infosys", accountManager: "Nisha Patel", status: "Active", transactions: 6, users: 115, revenue: 358000, cost: 249200 },
  { name: "TCS", accountManager: "Ritu Sharma", status: "Active", transactions: 5, users: 102, revenue: 301000, cost: 217300 },
  { name: "Wipro", accountManager: "Kavya Iyer", status: "Inactive", transactions: 3, users: 44, revenue: 118000, cost: 92300 },
];

export function CustomersExampleView() {
  const totals = EXAMPLE_CUSTOMERS.reduce(
    (acc, row) => {
      acc.transactions += row.transactions;
      acc.users += row.users;
      acc.revenue += row.revenue;
      acc.cost += row.cost;
      return acc;
    },
    { transactions: 0, users: 0, revenue: 0, cost: 0 },
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>{fmtNumber(EXAMPLE_CUSTOMERS.length)} customers</span>
            <span>Transactions: {fmtNumber(totals.transactions)}</span>
            <span>Users: {fmtNumber(totals.users)}</span>
            <span>Revenue: {fmtCurrency(totals.revenue)}</span>
            <span>Profit: {fmtCurrency(totals.revenue - totals.cost)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Customers (example)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Account Manager</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Transactions</TableHead>
                <TableHead className="text-right">Users</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {EXAMPLE_CUSTOMERS.map((row) => (
                <TableRow key={row.name}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>{row.accountManager}</TableCell>
                  <TableCell>
                    <Badge variant={row.status === "Active" ? "default" : "secondary"}>{row.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{fmtNumber(row.transactions)}</TableCell>
                  <TableCell className="text-right">{fmtNumber(row.users)}</TableCell>
                  <TableCell className="text-right">{fmtCurrency(row.revenue)}</TableCell>
                  <TableCell className="text-right">{fmtCurrency(row.cost)}</TableCell>
                  <TableCell className="text-right">{fmtCurrency(row.revenue - row.cost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
