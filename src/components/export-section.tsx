import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Download, FileSpreadsheet } from "lucide-react";
import { Contact } from "@/shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

export default function ExportSection() {
  const { toast } = useToast();
  const [selectedFilter, setSelectedFilter] = useState("all");

  const { data: contacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const exportVCFMutation = useMutation({
    mutationFn: async (_filter: string) => {
      const response = await fetch("/api/export/vcf");
      if (!response.ok) throw new Error("VCF export failed");
      return true;
    },
    onSuccess: () => {
      toast({
        title: "VCF Export Complete",
        description: "VCF export downloaded successfully",
      });
      window.open("/api/export/vcf", '_blank');
    },
    onError: () => {
      toast({
        title: "Export Failed",
        description: "Failed to export VCF file",
        variant: "destructive",
      });
    },
  });

  const exportCSVMutation = useMutation({
    mutationFn: async (_filter: string) => {
      const response = await fetch("/api/export/csv");
      if (!response.ok) throw new Error("CSV export failed");
      return true;
    },
    onSuccess: () => {
      toast({
        title: "CSV Export Complete",
        description: "CSV export downloaded successfully",
      });
      window.open("/api/export/csv", '_blank');
    },
    onError: () => {
      toast({
        title: "Export Failed",
        description: "Failed to export CSV file",
        variant: "destructive",
      });
    },
  });

  const handleExportVCF = () => {
    exportVCFMutation.mutate(selectedFilter);
  };

  const handleExportCSV = () => {
    exportCSVMutation.mutate(selectedFilter);
  };

  const getFilteredContactCount = () => {
    if (!contacts) return 0;
    
    switch (selectedFilter) {
      case 'new':
        return contacts.filter((c) => !c.saved).length;
      case 'last24h':
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return contacts.filter((c) => c.createdAt && new Date(c.createdAt) >= yesterday).length;
      case 'lastweek':
        const lastWeek = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);
        return contacts.filter((c) => c.createdAt && new Date(c.createdAt) >= lastWeek).length;
      default:
        return contacts.length;
    }
  };

  const contactCount = getFilteredContactCount();

  return (
    <Card className="shadow-sm" data-testid="export-section">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Export Contacts</CardTitle>
            <p className="text-sm text-muted-foreground">
              Generate VCF or CSV files for contact import
            </p>
          </div>
          <Select value={selectedFilter} onValueChange={setSelectedFilter} data-testid="select-export-filter">
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Filter contacts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All contacts</SelectItem>
              <SelectItem value="new">New contacts only</SelectItem>
              <SelectItem value="last24h">Last 24 hours</SelectItem>
              <SelectItem value="lastweek">Last week</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <Card
            className="border border-border hover:bg-accent transition-colors cursor-pointer"
            onClick={handleExportVCF}
            data-testid="card-export-vcf"
          >
            <CardContent className="p-4">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <FileText className="text-blue-600 w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-medium text-foreground">Export as VCF</h4>
                  <p className="text-sm text-muted-foreground">
                    Compatible with iOS, Android, Outlook
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Ready to export: <span className="font-medium" data-testid="vcf-count">
                      {contactCount} contacts
                    </span>
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card
            className="border border-border hover:bg-accent transition-colors cursor-pointer"
            onClick={handleExportCSV}
            data-testid="card-export-csv"
          >
            <CardContent className="p-4">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                  <FileSpreadsheet className="text-green-600 w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-medium text-foreground">Export as CSV</h4>
                  <p className="text-sm text-muted-foreground">
                    Excel, Google Sheets compatible
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Ready to export: <span className="font-medium" data-testid="csv-count">
                      {contactCount} contacts
                    </span>
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {(exportVCFMutation.isPending || exportCSVMutation.isPending) && (
          <div className="mt-4 p-4 bg-muted rounded-lg text-center" data-testid="export-loading">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Generating export file...</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
