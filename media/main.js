(function() {
  console.log('[GoFlow] main.js loaded');
  
  try {
    const vscode = acquireVsCodeApi();
    let cy;
    let currentLayout = 'cose'; // Default to cose instead of dagre
    let isDagreAvailable = false;
    
    // Debug: Check if cytoscape is available
    if (typeof cytoscape === 'undefined') {
      console.error('[GoFlow] Cytoscape is not defined!');
      const loadingEl = document.getElementById('loading');
      if (loadingEl) {
        loadingEl.innerHTML = 'ERROR: Cytoscape library failed to load. Check your internet connection or firewall settings.';
        loadingEl.style.color = 'red';
      }
      return;
    }
    console.log('[GoFlow] Cytoscape version:', cytoscape.version);
    
    // Register dagre layout if available
    if (typeof cytoscape !== 'undefined' && typeof dagre !== 'undefined' && typeof cytoscapeDagre !== 'undefined') {
      try {
        cytoscape.use(cytoscapeDagre);
        isDagreAvailable = true;
        currentLayout = 'dagre';
        console.log('[GoFlow] Dagre layout registered successfully');
      } catch (e) {
        console.warn('[GoFlow] Failed to register dagre layout:', e);
        console.warn('[GoFlow] Falling back to cose layout');
      }
    } else {
      console.warn('[GoFlow] Dagre layout not available, using cose layout');
      console.log('cytoscape:', typeof cytoscape);
      console.log('dagre:', typeof dagre);
      console.log('cytoscapeDagre:', typeof cytoscapeDagre);
    }

    const nodeColors = {
      function: '#4CAF50',
      method: '#2196F3',
      struct: '#FF9800',
      interface: '#9C27B0',
      unknown: '#757575'
    };

    window.addEventListener('message', event => {
      const message = event.data;
      
      switch (message.command) {
        case 'renderGraph':
          renderGraph(message.data);
          break;
        case 'refresh':
          if (cy) {
            cy.fit();
          }
          break;
        case 'showCodePreview':
          showTooltip(message.nodeId, message.code);
          break;
        case 'exportRequest':
          exportDiagram();
          break;
      }
    });

    function getLayoutOptions(layoutName) {
        // Fallback to cose if dagre requested but not available
        if (layoutName === 'dagre' && !isDagreAvailable) {
        console.warn('[GoFlow] Dagre not available, falling back to cose layout');
        layoutName = 'cose';
        }
        
        const layouts = {
        dagre: isDagreAvailable ? {
            name: 'dagre',
            rankDir: 'TB',
            nodeSep: 50,
            rankSep: 100,
            animate: false
        } : {
            name: 'cose',
            idealEdgeLength: 100,
            nodeOverlap: 20,
            refresh: 20,
            fit: true,
            padding: 30,
            randomize: false,
            componentSpacing: 100
        },
        cose: {
          name: 'cose',
          idealEdgeLength: 100,
          nodeOverlap: 20,
          refresh: 20,
          fit: true,
          padding: 30,
          randomize: false,
          componentSpacing: 100
        },
        circle: {
          name: 'circle',
          fit: true,
          padding: 30,
          avoidOverlap: true
        },
        grid: {
          name: 'grid',
          fit: true,
          padding: 30,
          avoidOverlap: true,
          rows: undefined,
          cols: undefined
        }
      };

      return layouts[layoutName] || layouts.dagre;
    }

    function renderGraph(data) {
      const elements = [];

      data.nodes.forEach(node => {
        elements.push({
          data: {
            id: node.id,
            label: node.label,
            type: node.type,
            file: node.file,
            line: node.line
          }
        });
      });

      data.edges.forEach(edge => {
        elements.push({
          data: {
            id: `${edge.source}_${edge.target}`,
            source: edge.source,
            target: edge.target,
            type: edge.type
          }
        });
      });

      if (cy) {
        cy.destroy();
      }

      cy = cytoscape({
        container: document.getElementById('canvas'),
        elements: elements,
        style: [
          {
            selector: 'node',
            style: {
              'background-color': function(ele) {
                return nodeColors[ele.data('type')] || nodeColors.unknown;
              },
              'label': 'data(label)',
              'width': 80,
              'height': 80,
              'text-valign': 'center',
              'text-halign': 'center',
              'font-size': '12px',
              'color': '#fff',
              'text-outline-width': 2,
              'text-outline-color': function(ele) {
                return nodeColors[ele.data('type')] || nodeColors.unknown;
              },
              'shape': function(ele) {
                const type = ele.data('type');
                if (type === 'struct') return 'rectangle';
                if (type === 'interface') return 'diamond';
                return 'ellipse';
              }
            }
          },
          {
            selector: 'node:selected',
            style: {
              'border-width': 3,
              'border-color': '#FFC107'
            }
          },
          {
            selector: 'edge',
            style: {
              'width': 2,
              'line-color': '#666',
              'target-arrow-color': '#666',
              'target-arrow-shape': 'triangle',
              'curve-style': 'bezier',
              'arrow-scale': 1.5
            }
          },
          {
            selector: 'edge:selected',
            style: {
              'line-color': '#FFC107',
              'target-arrow-color': '#FFC107',
              'width': 3
            }
          }
        ],
        layout: getLayoutOptions(currentLayout)
      });

      cy.on('tap', 'node', function(evt) {
        const node = evt.target;
        const file = node.data('file');
        const line = node.data('line');
        
        vscode.postMessage({
          command: 'jumpToDefinition',
          file: file,
          line: line
        });
      });

      cy.on('mouseover', 'node', function(evt) {
        const node = evt.target;
        const file = node.data('file');
        const line = node.data('line');
        const nodeId = node.data('id');
        
        vscode.postMessage({
          command: 'getCodePreview',
          file: file,
          line: line,
          nodeId: nodeId
        });
      });

      cy.on('mouseout', 'node', function() {
        hideTooltip();
      });

      setupControls();
      cy.fit();
    }

    function setupControls() {
      document.getElementById('fit-btn').onclick = () => {
        if (cy) cy.fit();
      };

      document.getElementById('zoom-in-btn').onclick = () => {
        if (cy) cy.zoom(cy.zoom() * 1.2);
      };

      document.getElementById('zoom-out-btn').onclick = () => {
        if (cy) cy.zoom(cy.zoom() * 0.8);
      };

      document.getElementById('export-btn').onclick = () => {
        exportDiagram();
      };

      document.getElementById('layout-select').onchange = (e) => {
        currentLayout = e.target.value;
        if (cy) {
          const layout = cy.layout(getLayoutOptions(currentLayout));
          layout.run();
        }
      };
    }

    function showTooltip(nodeId, code) {
      const tooltip = document.getElementById('tooltip');
      const node = cy.getElementById(nodeId);
      
      if (node.length === 0) return;

      const renderedPosition = node.renderedPosition();
      
      tooltip.innerHTML = `<pre><code class="language-go">${escapeHtml(code)}</code></pre>`;
      tooltip.style.display = 'block';
      tooltip.style.left = `${renderedPosition.x + 50}px`;
      tooltip.style.top = `${renderedPosition.y}px`;
    }

    function hideTooltip() {
      const tooltip = document.getElementById('tooltip');
      tooltip.style.display = 'none';
    }

    function escapeHtml(text) {
      const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      };
      return text.replace(/[&<>"']/g, m => map[m]);
    }

    function exportDiagram() {
      if (!cy) return;
      
      const png = cy.png({
        output: 'base64',
        bg: '#1e1e1e',
        full: true,
        scale: 2
      });
      
      vscode.postMessage({
        command: 'export',
        dataUrl: png
      });
    }

    // Global error handler
    window.addEventListener('error', function(e) {
      console.error('[GoFlow] Global error:', e.error);
      const loadingEl = document.getElementById('loading');
      if (loadingEl && loadingEl.style.display !== 'none') {
        loadingEl.innerHTML = `Error: ${e.message}<br>Check console for details.`;
        loadingEl.style.color = 'red';
      }
    });

    window.addEventListener('unhandledrejection', function(e) {
      console.error('[GoFlow] Unhandled promise rejection:', e.reason);
    });

    vscode.postMessage({ command: 'ready' });
    
  } catch (error) {
    console.error('[GoFlow] Fatal error during initialization:', error);
    const loadingEl = document.getElementById('loading');
    if (loadingEl) {
      loadingEl.innerHTML = `Fatal Error: ${error.message}<br>Stack: ${error.stack}`;
      loadingEl.style.color = 'red';
    }
  }
})();