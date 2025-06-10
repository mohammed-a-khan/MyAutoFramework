// src/core/debugging/VideoRecorder.ts

import { Page, BrowserContext } from 'playwright';
import { Logger } from '../utils/Logger';
import { ActionLogger } from '../logging/ActionLogger';
import { FileUtils } from '../utils/FileUtils';
import { DateUtils } from '../utils/DateUtils';
import { ConfigurationManager } from '../configuration/ConfigurationManager';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { 
    VideoOptions, 
    VideoFormat, 
    VideoQuality,
    VideoAnnotation 
} from './types/debug.types';

const execAsync = promisify(exec);

/**
 * Records test execution videos for debugging and evidence
 * Supports multiple formats and quality settings
 */
export class VideoRecorder {
    private static instance: VideoRecorder;
    private activeRecordings: Map<string, VideoSession> = new Map();
    private videoPath: string;
    private defaultOptions!: VideoOptions;
    private ffmpegAvailable: boolean = false;
    private logger: Logger;
    
    private constructor() {
        this.videoPath = path.join(process.cwd(), 'videos');
        this.logger = Logger.getInstance('VideoRecorder');
        this.loadConfiguration();
        this.initialize();
    }
    
    static getInstance(): VideoRecorder {
        if (!VideoRecorder.instance) {
            VideoRecorder.instance = new VideoRecorder();
        }
        return VideoRecorder.instance;
    }
    
    private loadConfiguration(): void {
        this.defaultOptions = {
            enabled: ConfigurationManager.getBoolean('VIDEO_RECORDING_ENABLED', false),
            format: ConfigurationManager.get('VIDEO_FORMAT', 'webm') as VideoFormat,
            quality: ConfigurationManager.get('VIDEO_QUALITY', 'medium') as VideoQuality,
            fps: ConfigurationManager.getInt('VIDEO_FPS', 30),
            width: ConfigurationManager.getInt('VIDEO_WIDTH', 1280),
            height: ConfigurationManager.getInt('VIDEO_HEIGHT', 720),
            preserveOutput: ConfigurationManager.getBoolean('VIDEO_PRESERVE_OUTPUT', true),
            compressVideo: ConfigurationManager.getBoolean('VIDEO_COMPRESS', true),
            includeAudio: ConfigurationManager.getBoolean('VIDEO_INCLUDE_AUDIO', false),
            highlightClicks: ConfigurationManager.getBoolean('VIDEO_HIGHLIGHT_CLICKS', true),
            watermark: ConfigurationManager.get('VIDEO_WATERMARK', ''),
            maxDuration: ConfigurationManager.getInt('VIDEO_MAX_DURATION', 3600) // 1 hour
        };
    }
    
    private async initialize(): Promise<void> {
        try {
            // Ensure video directory exists
            await FileUtils.ensureDir(this.videoPath);
            
            // Check if ffmpeg is available for advanced features
            await this.checkFFmpegAvailability();
            
            // Clean old videos if needed
            if (!this.defaultOptions.preserveOutput) {
                await this.cleanOldVideos();
            }
            
            this.logger.info('VideoRecorder initialized');
            
        } catch (error) {
            this.logger.error(`Failed to initialize VideoRecorder: ${(error as Error).message}`);
        }
    }
    
    /**
     * Start video recording for a page
     */
    async startRecording(
        page: Page,
        options?: Partial<VideoOptions>
    ): Promise<string> {
        try {
            const sessionId = this.generateSessionId();
            const videoOpts = { ...this.defaultOptions, ...options };
            
            if (!videoOpts.enabled) {
                this.logger.debug('Video recording is disabled');
                return '';
            }
            
            const context = page.context();
            
            // Check if already recording
            if (this.isContextRecording(context)) {
                this.logger.warn('Video already recording for this context');
                return this.getActiveRecordingId(context);
            }
            
            // Create video file path
            const timestamp = DateUtils.toTimestamp(new Date());
            const fileName = `video-${timestamp}-${sessionId}.${videoOpts.format}`;
            const filePath = path.join(this.videoPath, fileName);
            
            // Configure video recording
            
            // Note: Playwright starts recording when context is created
            // For existing context, we need to use a workaround
            if (!(context as any)._options?.recordVideo) {
                this.logger.warn('Video recording must be enabled when creating browser context');
                return '';
            }
            
            // Create video session
            const session: VideoSession = {
                id: sessionId,
                startTime: new Date(),
                filePath,
                fileName,
                context,
                page,
                options: videoOpts,
                events: [],
                metadata: {
                    url: page.url(),
                    title: await page.title(),
                    viewport: page.viewportSize(),
                    userAgent: await page.evaluate(() => navigator.userAgent)
                },
                frameCount: 0,
                duration: 0
            };
            
            this.activeRecordings.set(sessionId, session);
            
            // Set up event tracking
            this.setupEventTracking(session);
            
            // Add click highlighting if enabled
            if (videoOpts.highlightClicks) {
                await this.injectClickHighlighter(page);
            }
            
            // Add watermark if specified
            if (videoOpts.watermark) {
                await this.injectWatermark(page, videoOpts.watermark);
            }
            
            this.logger.info(`🎥 Video recording started: ${sessionId}`);
            ActionLogger.logInfo('Video recording started', { sessionId, filePath });
            
            return sessionId;
            
        } catch (error) {
            this.logger.error(`Failed to start video recording: ${(error as Error).message}`);
            throw error;
        }
    }
    
    /**
     * Stop video recording
     */
    async stopRecording(sessionId?: string): Promise<string> {
        try {
            const session = sessionId 
                ? this.activeRecordings.get(sessionId)
                : this.getLatestSession();
            
            if (!session) {
                throw new Error(`No active video recording found${sessionId ? `: ${sessionId}` : ''}`);
            }
            
            session.endTime = new Date();
            session.duration = (session.endTime.getTime() - session.startTime.getTime()) / 1000;
            
            // Close page to trigger video save
            const videoPath = await session.page.video()?.path();
            
            if (!videoPath) {
                throw new Error('Video path not available');
            }
            
            // Update session with actual path
            session.filePath = videoPath;
            session.fileName = path.basename(videoPath);
            
            // Wait for video to be written
            await this.waitForVideoFile(videoPath);
            
            // Post-process video if needed
            const finalPath = await this.postProcessVideo(session);
            
            // Save metadata
            await this.saveVideoMetadata(session);
            
            // Generate thumbnail
            await this.generateThumbnail(finalPath);
            
            // Clean up
            this.removeEventTracking(session);
            this.activeRecordings.delete(session.id);
            
            const stats = await fs.promises.stat(finalPath);
            
            this.logger.info(`🎥 Video recording stopped: ${session.id}`);
            this.logger.info(`   Duration: ${this.formatDuration(session.duration)}`);
            this.logger.info(`   Size: ${this.formatFileSize(stats.size)}`);
            this.logger.info(`   File: ${path.basename(finalPath)}`);
            ActionLogger.logInfo('Video recording stopped', { sessionId: session.id, path: finalPath, duration: session.duration });
            
            return finalPath;
            
        } catch (error) {
            this.logger.error(`Failed to stop video recording: ${(error as Error).message}`);
            throw error;
        }
    }
    
    /**
     * Save current video without stopping
     */
    async saveVideo(sessionId?: string): Promise<string> {
        const session = sessionId 
            ? this.activeRecordings.get(sessionId)
            : this.getLatestSession();
        
        if (!session) {
            throw new Error('No active video recording found');
        }
        
        const videoPath = await session.page.video()?.path();
        
        if (!videoPath) {
            throw new Error('Video not available yet');
        }
        
        // Create a copy of the current video
        const timestamp = DateUtils.toTimestamp(new Date());
        const checkpointPath = path.join(
            this.videoPath,
            `checkpoint-${timestamp}-${session.fileName}`
        );
        
        await fs.promises.copyFile(videoPath, checkpointPath);
        
        this.logger.info(`💾 Video checkpoint saved: ${path.basename(checkpointPath)}`);
        
        return checkpointPath;
    }
    
    /**
     * Attach video to test report
     */
    async attachVideoToReport(videoPath: string): Promise<VideoAttachment> {
        try {
            const stats = await fs.promises.stat(videoPath);
            const metadata = await this.extractVideoMetadata(videoPath);
            
            return {
                path: videoPath,
                fileName: path.basename(videoPath),
                size: stats.size,
                duration: metadata.duration,
                format: metadata.format,
                resolution: metadata.resolution,
                fps: metadata.fps,
                createdAt: stats.birthtime
            };
            
        } catch (error) {
            this.logger.error(`Failed to attach video to report: ${(error as Error).message}`);
            throw error;
        }
    }
    
    /**
     * Get active video recordings
     */
    getActiveRecordings(): VideoInfo[] {
        return Array.from(this.activeRecordings.values()).map(session => ({
            id: session.id,
            startTime: session.startTime,
            url: session.metadata.url,
            title: session.metadata.title,
            duration: this.calculateDuration(session),
            frameCount: session.frameCount
        }));
    }
    
    /**
     * Compress video file
     */
    async compressVideo(
        inputPath: string,
        outputPath?: string,
        compressionLevel: 'low' | 'medium' | 'high' = 'medium'
    ): Promise<string> {
        try {
            if (!this.ffmpegAvailable) {
                this.logger.warn('FFmpeg not available for video compression');
                return inputPath;
            }
            
            const output = outputPath || inputPath.replace(/\.[^.]+$/, '-compressed.$&');
            
            const crf = {
                low: 18,    // Higher quality, larger file
                medium: 23, // Balanced
                high: 28    // Lower quality, smaller file
            }[compressionLevel];
            
            const command = `ffmpeg -i "${inputPath}" -c:v libx264 -crf ${crf} -preset medium -c:a copy "${output}" -y`;
            
            this.logger.info('Compressing video...');
            const startTime = Date.now();
            
            await execAsync(command);
            
            const duration = Date.now() - startTime;
            const [inputStats, outputStats] = await Promise.all([
                fs.promises.stat(inputPath),
                fs.promises.stat(output)
            ]);
            
            const reduction = ((1 - outputStats.size / inputStats.size) * 100).toFixed(1);
            
            this.logger.info(`Video compressed in ${duration}ms (${reduction}% reduction)`);
            
            // Delete original if compressing in place
            if (!outputPath && output !== inputPath) {
                await fs.promises.unlink(inputPath);
                await fs.promises.rename(output, inputPath);
                return inputPath;
            }
            
            return output;
            
        } catch (error) {
            this.logger.error(`Failed to compress video: ${(error as Error).message}`);
            return inputPath;
        }
    }
    
    /**
     * Merge multiple video files
     */
    async mergeVideos(videoPaths: string[], outputPath: string): Promise<string> {
        try {
            if (!this.ffmpegAvailable) {
                throw new Error('FFmpeg required for video merging');
            }
            
            // Create file list for ffmpeg
            const listFile = path.join(this.videoPath, `merge-list-${Date.now()}.txt`);
            const fileList = videoPaths.map(p => `file '${p}'`).join('\n');
            await fs.promises.writeFile(listFile, fileList);
            
            const command = `ffmpeg -f concat -safe 0 -i "${listFile}" -c copy "${outputPath}" -y`;
            
            this.logger.info(`Merging ${videoPaths.length} videos...`);
            await execAsync(command);
            
            // Clean up
            await fs.promises.unlink(listFile);
            
            this.logger.info(`Videos merged: ${path.basename(outputPath)}`);
            
            return outputPath;
            
        } catch (error) {
            this.logger.error(`Failed to merge videos: ${(error as Error).message}`);
            throw error;
        }
    }
    
    /**
     * Extract video frames
     */
    async extractFrames(
        videoPath: string,
        outputDir: string,
        options?: {
            interval?: number; // Extract every N seconds
            count?: number;    // Total frames to extract
            format?: 'png' | 'jpg';
        }
    ): Promise<string[]> {
        try {
            if (!this.ffmpegAvailable) {
                throw new Error('FFmpeg required for frame extraction');
            }
            
            await FileUtils.ensureDir(outputDir);
            
            const opts = {
                interval: 1,
                format: 'png' as const,
                ...options
            };
            
            const outputPattern = path.join(outputDir, `frame-%04d.${opts.format}`);
            
            let command: string;
            if (opts.count) {
                // Extract specific number of frames
                command = `ffmpeg -i "${videoPath}" -vframes ${opts.count} "${outputPattern}" -y`;
            } else {
                // Extract frames at interval
                command = `ffmpeg -i "${videoPath}" -vf fps=1/${opts.interval} "${outputPattern}" -y`;
            }
            
            this.logger.info('Extracting video frames...');
            await execAsync(command);
            
            // Get list of extracted frames
            const files = await fs.promises.readdir(outputDir);
            const frames = files
                .filter(f => f.startsWith('frame-') && f.endsWith(`.${opts.format}`))
                .map(f => path.join(outputDir, f))
                .sort();
            
            this.logger.info(`Extracted ${frames.length} frames`);
            
            return frames;
            
        } catch (error) {
            this.logger.error(`Failed to extract frames: ${(error as Error).message}`);
            throw error;
        }
    }
    
    /**
     * Add annotations to video
     */
    async annotateVideo(
        videoPath: string,
        annotations: VideoAnnotation[],
        outputPath?: string
    ): Promise<string> {
        try {
            if (!this.ffmpegAvailable) {
                this.logger.warn('FFmpeg not available for video annotation');
                return videoPath;
            }
            
            const output = outputPath || videoPath.replace(/\.[^.]+$/, '-annotated.$&');
            
            // Build FFmpeg filter for annotations
            const drawTextFilters = annotations
                .filter(a => a.type === 'text')
                .map(a => {
                    const text = a.text!.replace(/'/g, "\\'");
                    const x = a.position?.x || 10;
                    const y = a.position?.y || 10;
                    const start = a.startTime || 0;
                    const duration = a.duration || 5;
                    
                    return `drawtext=text='${text}':x=${x}:y=${y}:fontsize=24:fontcolor=red:` +
                           `enable='between(t,${start},${start + duration})'`;
                });
            
            if (drawTextFilters.length === 0) {
                this.logger.warn('No text annotations to apply');
                return videoPath;
            }
            
            const filterComplex = drawTextFilters.join(',');
            const command = `ffmpeg -i "${videoPath}" -vf "${filterComplex}" -c:a copy "${output}" -y`;
            
            this.logger.info('Adding annotations to video...');
            await execAsync(command);
            
            this.logger.info(`Video annotated: ${path.basename(output)}`);
            
            return output;
            
        } catch (error) {
            this.logger.error(`Failed to annotate video: ${(error as Error).message}`);
            return videoPath;
        }
    }
    
    /**
     * Generate GIF from video
     */
    async generateGIF(
        videoPath: string,
        outputPath?: string,
        options?: {
            startTime?: number;
            duration?: number;
            width?: number;
            fps?: number;
        }
    ): Promise<string> {
        try {
            if (!this.ffmpegAvailable) {
                throw new Error('FFmpeg required for GIF generation');
            }
            
            const output = outputPath || videoPath.replace(/\.[^.]+$/, '.gif');
            const opts = {
                startTime: 0,
                duration: 10,
                width: 480,
                fps: 10,
                ...options
            };
            
            // Generate palette for better quality
            const palettePath = path.join(this.videoPath, `palette-${Date.now()}.png`);
            
            const paletteCommand = `ffmpeg -ss ${opts.startTime} -t ${opts.duration} -i "${videoPath}" ` +
                                  `-vf "fps=${opts.fps},scale=${opts.width}:-1:flags=lanczos,palettegen" "${palettePath}" -y`;
            
            await execAsync(paletteCommand);
            
            // Generate GIF using palette
            const gifCommand = `ffmpeg -ss ${opts.startTime} -t ${opts.duration} -i "${videoPath}" -i "${palettePath}" ` +
                              `-filter_complex "fps=${opts.fps},scale=${opts.width}:-1:flags=lanczos[x];[x][1:v]paletteuse" ` +
                              `"${output}" -y`;
            
            this.logger.info('Generating GIF from video...');
            await execAsync(gifCommand);
            
            // Clean up palette
            await fs.promises.unlink(palettePath);
            
            const stats = await fs.promises.stat(output);
            this.logger.info(`GIF generated: ${path.basename(output)} (${this.formatFileSize(stats.size)})`);
            
            return output;
            
        } catch (error) {
            this.logger.error(`Failed to generate GIF: ${(error as Error).message}`);
            throw error;
        }
    }
    
    /**
     * Clean up old video files
     */
    async cleanOldVideos(daysToKeep: number = 7): Promise<number> {
        try {
            const files = await fs.promises.readdir(this.videoPath);
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
            
            let deletedCount = 0;
            
            for (const file of files) {
                if (file.startsWith('video-') && 
                    (file.endsWith('.webm') || file.endsWith('.mp4'))) {
                    const filePath = path.join(this.videoPath, file);
                    const stats = await fs.promises.stat(filePath);
                    
                    if (stats.mtime < cutoffDate) {
                        await fs.promises.unlink(filePath);
                        
                        // Also delete metadata and thumbnail if exists
                        const metadataPath = filePath.replace(/\.[^.]+$/, '-metadata.json');
                        const thumbnailPath = filePath.replace(/\.[^.]+$/, '-thumbnail.png');
                        
                        if (await FileUtils.exists(metadataPath)) {
                            await fs.promises.unlink(metadataPath);
                        }
                        
                        if (await FileUtils.exists(thumbnailPath)) {
                            await fs.promises.unlink(thumbnailPath);
                        }
                        
                        deletedCount++;
                    }
                }
            }
            
            if (deletedCount > 0) {
                this.logger.info(`Cleaned ${deletedCount} old video files`);
            }
            
            return deletedCount;
            
        } catch (error) {
            this.logger.error(`Failed to clean old videos: ${(error as Error).message}`);
            return 0;
        }
    }
    
    // Private helper methods
    
    private async checkFFmpegAvailability(): Promise<void> {
        try {
            await execAsync('ffmpeg -version');
            this.ffmpegAvailable = true;
            this.logger.info('FFmpeg is available for advanced video features');
        } catch (error) {
            this.ffmpegAvailable = false;
            this.logger.warn('FFmpeg not found. Some video features will be limited');
        }
    }
    
    private setupEventTracking(session: VideoSession): void {
        const page = session.page;
        
        // Track page events
        page.on('load', () => {
            session.events.push({
                type: 'pageLoad',
                timestamp: new Date(),
                data: { url: page.url() }
            });
        });
        
        // Track errors
        page.on('pageerror', error => {
            session.events.push({
                type: 'error',
                timestamp: new Date(),
                data: { message: (error as Error).message, stack: error.stack }
            });
        });
        
        // Track frame count (approximate)
        const frameInterval = setInterval(() => {
            if (this.activeRecordings.has(session.id)) {
                session.frameCount += session.options.fps / 10; // Update every 100ms
            } else {
                clearInterval(frameInterval);
            }
        }, 100);
        
        session.frameInterval = frameInterval;
    }
    
    private removeEventTracking(session: VideoSession): void {
        if (session.frameInterval) {
            clearInterval(session.frameInterval);
        }
    }
    
    private async injectClickHighlighter(page: Page): Promise<void> {
        await page.addInitScript(() => {
            document.addEventListener('click', (e) => {
                const highlight = document.createElement('div');
                highlight.style.cssText = `
                    position: fixed;
                    width: 20px;
                    height: 20px;
                    background: rgba(255, 0, 0, 0.5);
                    border: 2px solid red;
                    border-radius: 50%;
                    pointer-events: none;
                    z-index: 999999;
                    animation: clickPulse 0.6s ease-out;
                `;
                
                const x = e.clientX;
                const y = e.clientY;
                highlight.style.left = `${x - 10}px`;
                highlight.style.top = `${y - 10}px`;
                
                const style = document.createElement('style');
                style.textContent = `
                    @keyframes clickPulse {
                        0% { transform: scale(1); opacity: 1; }
                        100% { transform: scale(3); opacity: 0; }
                    }
                `;
                
                document.head.appendChild(style);
                document.body.appendChild(highlight);
                
                setTimeout(() => {
                    highlight.remove();
                    style.remove();
                }, 600);
            }, true);
        });
    }
    
    private async injectWatermark(page: Page, watermarkText: string): Promise<void> {
        await page.addInitScript((text) => {
            const watermark = document.createElement('div');
            watermark.style.cssText = `
                position: fixed;
                top: 10px;
                right: 10px;
                background: rgba(0, 0, 0, 0.5);
                color: white;
                padding: 5px 10px;
                font-family: Arial, sans-serif;
                font-size: 12px;
                border-radius: 3px;
                z-index: 999998;
                pointer-events: none;
            `;
            watermark.textContent = text;
            document.body.appendChild(watermark);
        }, watermarkText);
    }
    
    private async waitForVideoFile(videoPath: string, timeout: number = 30000): Promise<void> {
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout) {
            try {
                const stats = await fs.promises.stat(videoPath);
                if (stats.size > 0) {
                    // Wait a bit more to ensure writing is complete
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return;
                }
            } catch (error) {
                // File doesn't exist yet
            }
            
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        throw new Error('Timeout waiting for video file');
    }
    
    private async postProcessVideo(session: VideoSession): Promise<string> {
        let videoPath = session.filePath;
        
        // Compress if enabled
        if (session.options.compressVideo && this.ffmpegAvailable) {
            videoPath = await this.compressVideo(videoPath);
        }
        
        // Add watermark if not already added during recording
        if (session.options.watermark && this.ffmpegAvailable && !session.options.highlightClicks) {
            videoPath = await this.addWatermarkToVideo(videoPath, session.options.watermark);
        }
        
        // Trim if exceeded max duration
        if (session.duration > session.options.maxDuration) {
            videoPath = await this.trimVideo(videoPath, session.options.maxDuration);
        }
        
        return videoPath;
    }
    
    private async addWatermarkToVideo(videoPath: string, watermarkText: string): Promise<string> {
        if (!this.ffmpegAvailable) return videoPath;
        
        try {
            const output = videoPath.replace(/\.[^.]+$/, '-watermarked.$&');
            const text = watermarkText.replace(/'/g, "\\'");
            
            const command = `ffmpeg -i "${videoPath}" -vf "drawtext=text='${text}':` +
                           `x=w-tw-10:y=10:fontsize=16:fontcolor=white@0.8:` +
                           `box=1:boxcolor=black@0.5:boxborderw=5" -c:a copy "${output}" -y`;
            
            await execAsync(command);
            
            // Replace original
            await fs.promises.unlink(videoPath);
            await fs.promises.rename(output, videoPath);
            
            return videoPath;
        } catch (error) {
            this.logger.error(`Failed to add watermark: ${(error as Error).message}`);
            return videoPath;
        }
    }
    
    private async trimVideo(videoPath: string, maxDuration: number): Promise<string> {
        if (!this.ffmpegAvailable) return videoPath;
        
        try {
            const output = videoPath.replace(/\.[^.]+$/, '-trimmed.$&');
            
            const command = `ffmpeg -i "${videoPath}" -t ${maxDuration} -c copy "${output}" -y`;
            
            await execAsync(command);
            
            // Replace original
            await fs.promises.unlink(videoPath);
            await fs.promises.rename(output, videoPath);
            
            this.logger.info(`Video trimmed to ${maxDuration} seconds`);
            
            return videoPath;
        } catch (error) {
            this.logger.error(`Failed to trim video: ${(error as Error).message}`);
            return videoPath;
        }
    }
    
    private async saveVideoMetadata(session: VideoSession): Promise<void> {
        try {
            const metadata = {
                id: session.id,
                startTime: session.startTime,
                endTime: session.endTime,
                duration: session.duration,
                frameCount: session.frameCount,
                options: session.options,
                metadata: session.metadata,
                events: session.events.map(e => ({
                    ...e,
                    timestamp: e.timestamp.toISOString()
                })),
                summary: this.generateSummary(session)
            };
            
            const metadataPath = session.filePath.replace(/\.[^.]+$/, '-metadata.json');
            await FileUtils.writeJSON(metadataPath, metadata);
            
        } catch (error) {
            this.logger.error(`Failed to save video metadata: ${(error as Error).message}`);
        }
    }
    
    private async generateThumbnail(videoPath: string): Promise<string | null> {
        if (!this.ffmpegAvailable) return null;
        
        try {
            const thumbnailPath = videoPath.replace(/\.[^.]+$/, '-thumbnail.png');
            
            // Extract frame at 1 second (or 0 if video is shorter)
            const command = `ffmpeg -i "${videoPath}" -ss 00:00:01 -vframes 1 "${thumbnailPath}" -y`;
            
            await execAsync(command);
            
            this.logger.debug(`Thumbnail generated: ${path.basename(thumbnailPath)}`);
            
            return thumbnailPath;
        } catch (error) {
            this.logger.error(`Failed to generate thumbnail: ${(error as Error).message}`);
            return null;
        }
    }
    
    private async extractVideoMetadata(videoPath: string): Promise<any> {
        if (!this.ffmpegAvailable) {
            const stats = await fs.promises.stat(videoPath);
            return {
                duration: 0,
                format: path.extname(videoPath).substring(1),
                resolution: { width: 0, height: 0 },
                fps: 0,
                size: stats.size
            };
        }
        
        try {
            const { stdout } = await execAsync(
                `ffprobe -v quiet -print_format json -show_format -show_streams "${videoPath}"`
            );
            
            const data = JSON.parse(stdout);
            const videoStream = data.streams.find((s: any) => s.codec_type === 'video');
            
            return {
                duration: parseFloat(data.format.duration || '0'),
                format: data.format.format_name,
                resolution: {
                    width: videoStream?.width || 0,
                    height: videoStream?.height || 0
                },
                fps: eval(videoStream?.r_frame_rate || '0'),
                bitrate: parseInt(data.format.bit_rate || '0'),
                size: parseInt(data.format.size || '0')
            };
        } catch (error) {
            this.logger.error(`Failed to extract video metadata: ${(error as Error).message}`);
            return {
                duration: 0,
                format: 'unknown',
                resolution: { width: 0, height: 0 },
                fps: 0
            };
        }
    }
    
    private generateSummary(session: VideoSession): VideoSummary {
        const errors = session.events.filter(e => e.type === 'error').length;
        const pageLoads = session.events.filter(e => e.type === 'pageLoad').length;
        
        return {
            totalFrames: session.frameCount,
            estimatedSize: session.frameCount * 50000, // Rough estimate
            errors,
            pageLoads,
            averageFPS: session.frameCount / (session.duration || 1)
        };
    }
    
    private isContextRecording(context: BrowserContext): boolean {
        for (const session of this.activeRecordings.values()) {
            if (session.context === context) {
                return true;
            }
        }
        return false;
    }
    
    private getActiveRecordingId(context: BrowserContext): string {
        for (const [id, session] of this.activeRecordings) {
            if (session.context === context) {
                return id;
            }
        }
        return '';
    }
    
    private getLatestSession(): VideoSession | undefined {
        if (this.activeRecordings.size === 0) return undefined;
        
        return Array.from(this.activeRecordings.values())
            .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())[0];
    }
    
    private calculateDuration(session: VideoSession): number {
        if (!session.startTime) return 0;
        
        const endTime = session.endTime || new Date();
        return (endTime.getTime() - session.startTime.getTime()) / 1000;
    }
    
    private formatDuration(seconds: number): string {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        
        if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }
    
    private formatFileSize(bytes: number): string {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(1)} ${units[unitIndex]}`;
    }
    
    private generateSessionId(): string {
        return `video-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
}

// Type definitions
interface VideoSession {
    id: string;
    startTime: Date;
    endTime?: Date;
    duration: number;
    filePath: string;
    fileName: string;
    context: BrowserContext;
    page: Page;
    options: VideoOptions;
    events: VideoEvent[];
    metadata: VideoPageMetadata;
    frameCount: number;
    frameInterval?: NodeJS.Timeout;
}

interface VideoEvent {
    type: string;
    timestamp: Date;
    data: any;
}

interface VideoPageMetadata {
    url: string;
    title: string;
    viewport: { width: number; height: number } | null;
    userAgent: string;
}

interface VideoInfo {
    id: string;
    startTime: Date;
    url: string;
    title: string;
    duration: number;
    frameCount: number;
}

interface VideoSummary {
    totalFrames: number;
    estimatedSize: number;
    errors: number;
    pageLoads: number;
    averageFPS: number;
}

// Note: Additional types for video results that are not in debug.types.ts
interface VideoAttachment {
    path: string;
    fileName: string;
    size: number;
    duration: number;
    format: string;
    resolution: { width: number; height: number };
    fps: number;
    createdAt: Date;
}