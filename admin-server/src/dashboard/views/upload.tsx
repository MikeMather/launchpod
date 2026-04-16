import type { FC } from 'hono/jsx'
import { Layout, type LayoutUser } from '../layout.js'

interface UploadPageProps {
  user: LayoutUser
  sessionId: string
  previewUrl: string
  uploadedFile?: {
    filename: string
    url: string
    path: string
  }
}

export const UploadPage: FC<UploadPageProps> = ({ user, sessionId, previewUrl, uploadedFile }) => (
  <Layout title="Upload Assets" user={user} activePath="">
    <div class="card">
      <h2>Upload Assets</h2>
      <p class="text-muted">
        Upload files for use in your editing session. Files will be saved to <code>public/assets/</code>
        and committed to your preview branch when uploaded.
      </p>

      <div class="mt-4 p-4" style="background: #f5f5f5; border-radius: 8px;">
        <p><strong>Session ID:</strong> {sessionId}</p>
        <p><strong>Preview URL:</strong> <a href={previewUrl} target="_blank" rel="noopener">{previewUrl}</a></p>
      </div>

      {uploadedFile ? (
        <div class="alert alert-success mt-4">
          <h3>File Uploaded Successfully!</h3>
          <p class="mt-2"><strong>Filename:</strong> <code>{uploadedFile.filename}</code></p>
          <p><strong>URL:</strong> <code>{uploadedFile.url}</code></p>
          <button
            class="button button-small mt-2"
            onclick={`navigator.clipboard.writeText('${uploadedFile.url}'); this.textContent='Copied!'; setTimeout(() => this.textContent='Copy URL', 1000)`}
          >
            Copy URL
          </button>
          <div class="mt-4">
            <a href={`/session/${sessionId}/upload`} class="button">Upload Another File</a>
          </div>
        </div>
      ) : (
        <form
          method="post"
          enctype="multipart/form-data"
          id="uploadForm"
          class="mt-4"
        >
          <div class="form-group">
            <label for="file">Select file or drag and drop</label>
            <div class="file-drop-area" id="dropArea">
              <input
                type="file"
                id="file"
                name="file"
                required
                onchange="handleFileSelect(this)"
              />
              <div class="file-drop-message">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                <p><strong>Click to select</strong> or drag and drop</p>
                <p class="text-muted">Any file type (max 10MB)</p>
              </div>
              <div class="file-selected" style="display: none;">
                <p><strong>Selected:</strong> <span id="fileName"></span></p>
                <p class="text-muted"><span id="fileSize"></span></p>
              </div>
            </div>
          </div>

          <button type="submit" class="button">Upload File</button>
        </form>
      )}
    </div>

    <script dangerouslySetInnerHTML={{__html: `
      const dropArea = document.getElementById('dropArea');
      const fileInput = document.getElementById('file');
      const fileName = document.getElementById('fileName');
      const fileSize = document.getElementById('fileSize');
      const form = document.getElementById('uploadForm');

      if (dropArea && fileInput) {
        // Prevent default drag behaviors
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
          dropArea.addEventListener(eventName, preventDefaults, false);
          document.body.addEventListener(eventName, preventDefaults, false);
        });

        // Highlight drop area when dragging over it
        ['dragenter', 'dragover'].forEach(eventName => {
          dropArea.addEventListener(eventName, highlight, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
          dropArea.addEventListener(eventName, unhighlight, false);
        });

        // Handle dropped files
        dropArea.addEventListener('drop', handleDrop, false);

        // Handle click to browse
        dropArea.addEventListener('click', () => {
          if (!fileInput.files.length) {
            fileInput.click();
          }
        });
      }

      function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
      }

      function highlight() {
        dropArea.classList.add('highlight');
      }

      function unhighlight() {
        dropArea.classList.remove('highlight');
      }

      function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
          fileInput.files = files;
          handleFileSelect(fileInput);
        }
      }

      function handleFileSelect(input) {
        if (input.files && input.files[0]) {
          const file = input.files[0];
          fileName.textContent = file.name;
          fileSize.textContent = formatBytes(file.size);
          dropArea.querySelector('.file-drop-message').style.display = 'none';
          dropArea.querySelector('.file-selected').style.display = 'block';
        }
      }

      function formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
      }
    `}} />

    <style dangerouslySetInnerHTML={{__html: `
      .form-group {
        margin-bottom: 1.5rem;
      }

      .form-group label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 600;
      }

      .file-drop-area {
        position: relative;
        border: 2px dashed #ccc;
        border-radius: 8px;
        padding: 3rem 1rem;
        text-align: center;
        cursor: pointer;
        transition: all 0.2s ease;
        background: #fafafa;
      }

      .file-drop-area:hover {
        border-color: #999;
        background: #f5f5f5;
      }

      .file-drop-area.highlight {
        border-color: #666;
        background: #eee;
      }

      .file-drop-area input[type="file"] {
        position: absolute;
        width: 100%;
        height: 100%;
        top: 0;
        left: 0;
        opacity: 0;
        cursor: pointer;
      }

      .file-drop-message svg {
        color: #999;
        margin-bottom: 1rem;
      }

      .file-drop-message p {
        margin: 0.5rem 0;
      }

      .file-selected {
        padding: 1rem;
      }

      .file-selected p {
        margin: 0.5rem 0;
      }

      .alert {
        padding: 1.5rem;
        border-radius: 8px;
        background: #d4edda;
        border: 1px solid #c3e6cb;
      }

      .alert-success {
        background: #d4edda;
        border-color: #c3e6cb;
        color: #155724;
      }

      .alert h3 {
        margin-top: 0;
        color: #155724;
      }

      .alert code {
        background: #fff;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 0.9em;
        color: #333;
        display: inline-block;
        margin-top: 0.25rem;
      }

      .button-small {
        padding: 0.5rem 1rem;
        font-size: 0.9em;
      }
    `}} />
  </Layout>
)
