import { useQuery } from "@tanstack/react-query";
import Sidebar from "@/components/sidebar";
import MetricsCards from "@/components/metrics-cards";
import RecentMessages from "@/components/recent-messages";
import DetectedNumbers from "@/components/detected-numbers";
import ExportSection from "@/components/export-section";
import { Button } from "@/components/ui/button";
import { RefreshCw, Download } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Analytics {
  totalMessages: number;
  detectedNumbers: number;
  totalContacts: number;
  newContactsToday: number;
  recentMessages: any[];
  recentContacts: any[];
}

export default function Dashboard() {
  const { toast } = useToast();

  const { data: analytics, isLoading: analyticsLoading } = useQuery<Analytics>({
    queryKey: ["/api/analytics"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/analytics"] });
    queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
    queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
    toast({
      title: "Refreshed",
      description: "Data has been refreshed successfully",
    });
  };

  const handleExport = () => {
    // This will be handled by the ExportSection component
    toast({
      title: "Export",
      description: "Scroll down to the export section to download contacts",
    });
  };

  return (
    <div className="flex h-screen bg-background" data-testid="dashboard-main">
      <Sidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-card border-b border-border px-6 py-4" data-testid="dashboard-header">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-foreground" data-testid="dashboard-title">
                Dashboard
              </h2>
              <p className="text-sm text-muted-foreground" data-testid="dashboard-description">
                Monitor WhatsApp messages and manage detected contacts
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <Button
                onClick={handleExport}
                className="bg-secondary text-secondary-foreground hover:bg-secondary/90"
                data-testid="button-export-header"
              >
                <Download className="w-4 h-4 mr-2" />
                Export Contacts
              </Button>
              <Button
                onClick={handleRefresh}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                data-testid="button-refresh"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-auto p-6" data-testid="dashboard-content">
          {analyticsLoading ? (
            <div className="flex items-center justify-center h-64" data-testid="loading-analytics">
              <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <MetricsCards analytics={analytics} />
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
                <RecentMessages />
                <DetectedNumbers />
              </div>

              <div className="mt-8">
                <ExportSection />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
