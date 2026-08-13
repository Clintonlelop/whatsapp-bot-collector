const { getUncachableGitHubClient } = require('./github-client.js');
const fs = require('fs');
const path = require('path');

async function pushToGitHub() {
    try {
        console.log('🔄 Initializing GitHub client...');
        const octokit = await getUncachableGitHubClient();
        
        // Get user info
        const { data: user } = await octokit.rest.users.getAuthenticated();
        console.log(`✅ Connected to GitHub as: ${user.login}`);
        
        // Repository details - you may need to adjust these
        const owner = user.login;
        const repo = 'whatsapp-bot-collector'; // Adjust as needed
        
        console.log(`📦 Pushing to repository: ${owner}/${repo}`);
        
        // Create or update repository if it doesn't exist
        try {
            await octokit.rest.repos.get({ owner, repo });
            console.log(`✅ Repository ${repo} exists`);
        } catch (error) {
            if (error.status === 404) {
                console.log(`🔨 Creating repository ${repo}...`);
                await octokit.rest.repos.createForAuthenticatedUser({
                    name: repo,
                    description: 'WhatsApp Bot with Contact Extraction and LID-to-Phone Conversion',
                    private: false
                });
                console.log(`✅ Repository ${repo} created`);
            } else {
                throw error;
            }
        }
        
        // Get current files to upload
        const filesToUpload = [
            'README.md',
            'package.json',
            'index.js',
            'server.js',
            'replit.md',
            'drizzle.config.js',
            'vite.config.ts',
            'tailwind.config.ts',
            'tsconfig.json',
            'postcss.config.js',
            'components.json',
            'index.html',
            'github-client.js',
            'push-to-github.js',
            'src/bot.js',
            'src/App.tsx',
            'src/main.tsx',
            'src/index.css',
            'src/commands/index.js',
            'src/storage/contacts.js',
            'src/storage/status.js',
            'src/utils/csv.js',
            'src/utils/logger.js',
            'src/utils/phone-utils.js',
            'src/services/phone-detector.js',
            'src/database/db.js',
            'src/database/schema.js',
            'src/hooks/use-toast.ts',
            'src/hooks/use-mobile.tsx',
            'src/lib/queryClient.ts',
            'src/lib/utils.ts',
            'src/pages/dashboard.tsx',
            'src/pages/not-found.tsx',
            'src/components/detected-numbers.tsx',
            'src/components/export-section.tsx',
            'src/components/metrics-cards.tsx',
            'src/components/recent-messages.tsx',
            'src/components/sidebar.tsx',
            'src/components/ui/accordion.tsx',
            'src/components/ui/alert-dialog.tsx',
            'src/components/ui/alert.tsx',
            'src/components/ui/avatar.tsx',
            'src/components/ui/badge.tsx',
            'src/components/ui/button.tsx',
            'src/components/ui/card.tsx',
            'src/components/ui/checkbox.tsx',
            'src/components/ui/dialog.tsx',
            'src/components/ui/dropdown-menu.tsx',
            'src/components/ui/form.tsx',
            'src/components/ui/input.tsx',
            'src/components/ui/label.tsx',
            'src/components/ui/navigation-menu.tsx',
            'src/components/ui/popover.tsx',
            'src/components/ui/progress.tsx',
            'src/components/ui/radio-group.tsx',
            'src/components/ui/scroll-area.tsx',
            'src/components/ui/select.tsx',
            'src/components/ui/separator.tsx',
            'src/components/ui/sheet.tsx',
            'src/components/ui/sidebar.tsx',
            'src/components/ui/skeleton.tsx',
            'src/components/ui/switch.tsx',
            'src/components/ui/table.tsx',
            'src/components/ui/tabs.tsx',
            'src/components/ui/textarea.tsx',
            'src/components/ui/toast.tsx',
            'src/components/ui/toaster.tsx',
            'src/components/ui/toggle.tsx',
            'src/components/ui/toggle-group.tsx',
            'src/components/ui/tooltip.tsx',
            'src/components/ui/slider.tsx',
            'public/index.html',
            'public/react.html',
            'database/owner.json',
            'database/premium.json'
        ];
        
        // Get the latest commit SHA
        let latestSha;
        try {
            const { data: ref } = await octokit.rest.git.getRef({
                owner,
                repo,
                ref: 'heads/main'
            });
            latestSha = ref.object.sha;
        } catch (error) {
            // Repository might be empty
            latestSha = null;
        }
        
        // Create tree with files
        const tree = [];
        
        for (const filePath of filesToUpload) {
            try {
                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath, 'utf8');
                    const blob = await octokit.rest.git.createBlob({
                        owner,
                        repo,
                        content: Buffer.from(content).toString('base64'),
                        encoding: 'base64'
                    });
                    
                    tree.push({
                        path: filePath,
                        mode: '100644',
                        type: 'blob',
                        sha: blob.data.sha
                    });
                    
                    console.log(`📄 Added file: ${filePath}`);
                }
            } catch (error) {
                console.warn(`⚠️ Skipped file ${filePath}: ${error.message}`);
            }
        }
        
        if (tree.length === 0) {
            console.log('❌ No files to upload');
            return;
        }
        
        // Create tree
        const { data: newTree } = await octokit.rest.git.createTree({
            owner,
            repo,
            tree,
            base_tree: latestSha
        });
        
        // Create commit
        const { data: commit } = await octokit.rest.git.createCommit({
            owner,
            repo,
            message: `🤖 Updated WhatsApp Bot - Enhanced LID conversion & contact extraction (${new Date().toISOString()})`,
            tree: newTree.sha,
            parents: latestSha ? [latestSha] : []
        });
        
        // Update reference
        if (latestSha) {
            await octokit.rest.git.updateRef({
                owner,
                repo,
                ref: 'heads/main',
                sha: commit.sha
            });
        } else {
            await octokit.rest.git.createRef({
                owner,
                repo,
                ref: 'refs/heads/main',
                sha: commit.sha
            });
        }
        
        console.log(`✅ Successfully pushed to GitHub!`);
        console.log(`🔗 Repository URL: https://github.com/${owner}/${repo}`);
        console.log(`📝 Commit SHA: ${commit.sha}`);
        
        return {
            success: true,
            url: `https://github.com/${owner}/${repo}`,
            commitSha: commit.sha
        };
        
    } catch (error) {
        console.error('❌ GitHub push failed:', error);
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    pushToGitHub()
        .then(result => {
            console.log('🎉 Push completed successfully!');
            process.exit(0);
        })
        .catch(error => {
            console.error('💥 Push failed:', error.message);
            process.exit(1);
        });
}

module.exports = { pushToGitHub };