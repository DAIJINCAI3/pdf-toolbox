"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";

interface FileUploaderProps {
  /** 允许的文件类型，例如 { "application/pdf": [".pdf"] } */
  accept: Record<string, string[]>;
  /** 是否允许多文件上传 */
  multiple: boolean;
  /** 文件选择回调 */
  onFilesSelected: (files: File[]) => void;
  /** 提示文字 */
  placeholder?: string;
  /** 副提示 */
  subPlaceholder?: string;
}

export default function FileUploader({
  accept,
  multiple,
  onFilesSelected,
  placeholder = "点击或拖拽文件到此处",
  subPlaceholder = "支持拖拽上传",
}: FileUploaderProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        onFilesSelected(acceptedFiles);
      }
    },
    [onFilesSelected]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    multiple,
  });

  return (
    <div
      {...getRootProps()}
      className={`cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition-colors ${
        isDragActive
          ? "border-blue-500 bg-blue-50"
          : "border-gray-300 bg-white hover:border-blue-400"
      }`}
    >
      <input {...getInputProps()} />
      <div className="mb-3 text-4xl">📁</div>
      <p className="text-lg font-medium text-gray-700">
        {isDragActive ? "松开即可上传" : placeholder}
      </p>
      <p className="mt-1 text-sm text-gray-400">{subPlaceholder}</p>
    </div>
  );
}
